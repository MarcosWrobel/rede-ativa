import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { logAudit, extractClientIp } from "@/lib/audit";
import { computeMinuteHash, generateVerificationCode } from "@/lib/ataCrypto";
import { getCurrentSchool } from "@/lib/currentSchool";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { verifyServerSigningPin, calculateBusinessDaysDiff } from "@/lib/signingPin";
import { checkRateLimit, resetRateLimit, RATE_LIMIT_POLICIES } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id } = await params;
    const ip = extractClientIp(req);

    // Lê payload opcional enviado junto com o pedido de lavratura para sincronização atômica
    let rawBody: any = null;
    try {
      const text = await req.text();
      if (text && text.trim()) {
        rawBody = JSON.parse(text);
      }
    } catch {
      rawBody = null;
    }

    // Proteção Anti-Brute-Force contra adivinhação de PIN de Fé Pública (SEC-08)
    const pinLockKey = `pin-fail:${authCheck.userId}`;
    const pinRateCheck = await checkRateLimit(pinLockKey, RATE_LIMIT_POLICIES.PIN_BRUTE_FORCE);
    if (!pinRateCheck.success) {
      await logAudit({
        action: "SIGNING_PIN_LOCKOUT",
        entityType: "User",
        entityId: authCheck.userId,
        details: {
          reason: "Bloqueio temporário por excesso de tentativas incorretas de PIN de Fé Pública (15 min)",
          attemptedMinuteId: id,
          retryAfterSeconds: pinRateCheck.retryAfterSeconds,
        },
        user: { id: authCheck.userId, name: authCheck.userName, email: authCheck.email },
        schoolId: authCheck.schoolId || "global",
        req,
      });

      return NextResponse.json(
        {
          error: `Muitas tentativas incorretas de PIN. Por segurança, o uso do PIN foi temporariamente bloqueado por ${pinRateCheck.retryAfterSeconds} segundos.`,
          retryAfter: pinRateCheck.retryAfterSeconds,
        },
        { status: 429 }
      );
    }

    // Validação estrita de Fé Pública (Lei nº 14.063/2020, Art. 4º, II):
    // Exige PIN cadastrado e verificado antes de lavrar oficialmente a ata (sem bypass para signingPinHash nulo)
    const pinCheck = await verifyServerSigningPin(prisma, authCheck.userId, rawBody?.signingPin);
    if (!pinCheck.ok) {
      return NextResponse.json({ error: pinCheck.error }, { status: pinCheck.status || 401 });
    }

    // PIN validado com sucesso: reseta eventuais falhas anteriores
    await resetRateLimit(pinLockKey);

    const currentYear = new Date().getFullYear();

    // Executa toda a sincronização e lavratura em transação atômica estrita
    let finalized: any = null;
    let lastTxError: any = null;
    let isAlreadyFinalized = false;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        finalized = await prisma.$transaction(
          async (tx) => {
            // 1. Consulta ata com bloqueio no escopo da transação
            const minute = await tx.pedagogicalMinute.findUnique({
              where: { id },
              include: {
                students: true,
                participants: true,
                actionItems: true,
              },
            });

            if (!minute) {
              throw new Error("NOT_FOUND:Ata pedagógica não encontrada");
            }

            const currentSchool = await getCurrentSchool(authCheck.schoolId);
            if (!assertTenantOwnership(minute.schoolId, currentSchool.id, authCheck.session)) {
              throw new Error("FORBIDDEN:Acesso negado a registro de outra instituição de ensino.");
            }

            // Idempotência: se já foi lavrada, sai com sucesso
            if (minute.status === "FINALIZED") {
              isAlreadyFinalized = true;
              return minute;
            }

            if (minute.status !== "DRAFT") {
              throw new Error(`STATUS_INVALID:Esta ata encontra-se com status '${minute.status}' e não pode ser lavrada.`);
            }

            // 1.1 Adquire lock transacional exclusivo por tenant e ano (Lei 14.063/2020)
            // Impede qualquer colisão de concorrência ou disputa de ataNumber entre pedagogas simultâneas da mesma escola.
            try {
              await tx.$executeRaw`
                SELECT pg_advisory_xact_lock(hashtext('seq_ata_' || ${minute.schoolId} || '_' || ${currentYear}::text));
              `;
            } catch (lockErr) {
              // Tolerância em ambientes de teste sem Postgres Advisory Locks
            }

            // 2. Se o cliente enviou os dados atualizados do formulário no momento de lavrar, sincroniza antes de selar o hash
            if (rawBody && typeof rawBody === "object") {
              if (Array.isArray(rawBody.studentIds) && rawBody.studentIds.length > 0) {
                const studentsDb = await tx.student.findMany({
                  where: { id: { in: rawBody.studentIds }, schoolId: minute.schoolId },
                  include: { classGroup: true },
                });
                if (studentsDb.length !== rawBody.studentIds.length) {
                  throw new Error(
                    "VALIDATION:Um ou mais estudantes informados não foram encontrados nesta instituição escolar para vincular."
                  );
                }
                await tx.pedagogicalMinuteStudent.deleteMany({ where: { minuteId: id } });
                await tx.pedagogicalMinuteStudent.createMany({
                  data: studentsDb.map((s) => ({
                    minuteId: id,
                    studentId: s.id,
                    studentNameSnapshot: s.name,
                    classNameSnapshot: s.classGroup?.name || null,
                    cgmSnapshot: s.cgm || null,
                  })),
                });
              }

              if (Array.isArray(rawBody.participants)) {
                const existingParticipants = minute.participants;
                const usedIds = new Set<string>();

                const validParticipants = rawBody.participants.filter(
                  (p: any) => p && (p.name?.trim() || p.signatureData || p.signatureMode === "REFUSED" || p.id)
                );

                const participantsToCreate = validParticipants.map((p: any) => {
                  const trimmedName = (p.name || "").trim();
                  const finalName = trimmedName.length >= 2 ? trimmedName : "Responsável Presente";

                  const match =
                    (p.id && existingParticipants.find((ep) => ep.id === p.id && !usedIds.has(ep.id))) ||
                    existingParticipants.find(
                      (ep) => !usedIds.has(ep.id) && ep.name.trim().toLowerCase() === finalName.toLowerCase()
                    ) ||
                    (existingParticipants.length === 1 && validParticipants.length === 1 && !usedIds.has(existingParticipants[0].id)
                      ? existingParticipants[0]
                      : undefined);

                  if (match?.id) usedIds.add(match.id);

                  const shouldClear = Boolean(p.clearSignature);
                  const isRefused = p.signatureMode === "REFUSED";

                  const sigData = shouldClear || isRefused ? null : (p.signatureData || match?.signatureData || null);
                  const sigMode = isRefused
                    ? "REFUSED"
                    : sigData
                      ? p.signatureMode && p.signatureMode !== "PENDING"
                        ? p.signatureMode
                        : match?.signatureMode || "SCREEN_CANVAS"
                      : "PENDING";
                  const signedAt = sigData ? (p.signedAt ? new Date(p.signedAt) : match?.signedAt || new Date()) : null;

                  // HARDENING JURÍDICO (Lei 14.063/2020): Provas de biometria e autenticação OIDC Google NÃO podem
                  // ser forjadas via payload de finalização. Preservam estritamente o estado verificado no banco via sign-token.
                  const bioVerified = shouldClear || isRefused ? false : (match?.biometricVerified ?? false);
                  const bioDevice = shouldClear || isRefused ? null : (match?.biometricDeviceType || null);
                  const bioTime = bioVerified ? (match?.biometricAuthTime || null) : null;

                  const verifiedEmail = shouldClear || isRefused ? null : (match?.verifiedEmail || null);
                  const verifiedGoogleName = shouldClear || isRefused ? null : (match?.verifiedGoogleName || null);
                  const verifiedGoogleSub = shouldClear || isRefused ? null : (match?.verifiedGoogleSub || null);
                  const emailVerifiedAt = verifiedEmail ? (match?.emailVerifiedAt || null) : null;

                  const effectiveSigMode = isRefused
                    ? "REFUSED"
                    : verifiedEmail
                      ? "ESCOLA_OAUTH"
                      : sigMode;

                  return {
                    ...(match?.id ? { id: match.id } : {}),
                    minuteId: id,
                    role: p.role || "RESPONSAVEL",
                    studentId: p.studentId || null,
                    name: finalName,
                    kinship: p.kinship || null,
                    documentType: p.documentType || null,
                    documentNumber: p.documentNumber || null,
                    documentVerifiedByStaff: Boolean(p.documentVerifiedByStaff),
                    phone: p.phone || null,
                    signatureMode: effectiveSigMode,
                    signatureData: sigData,
                    signedAt: sigData || verifiedEmail ? (signedAt || new Date()) : null,
                    signerIp: shouldClear || isRefused ? null : (match?.signerIp || null),
                    signerUserAgent: shouldClear || isRefused ? null : (match?.signerUserAgent || p.signerUserAgent || null),
                    biometricStrokeData: shouldClear || isRefused ? null : (match?.biometricStrokeData || p.biometricStrokeData || null),
                    clientTimestampIso: shouldClear || isRefused ? null : (match?.clientTimestampIso || p.clientTimestampIso || null),
                    mobileSignToken: null,
                    mobileSignExpiresAt: null,
                    biometricVerified: bioVerified,
                    biometricDeviceType: bioDevice,
                    biometricAuthTime: bioTime,
                    expectedEmail: p.expectedEmail !== undefined ? p.expectedEmail : (match?.expectedEmail || null),
                    verifiedEmail,
                    verifiedGoogleSub,
                    verifiedGoogleName,
                    emailVerifiedAt,
                    refusalReason: isRefused ? (p.refusalReason || null) : null,
                    witnessName: isRefused ? (p.witnessName || null) : null,
                  };
                });

                await tx.pedagogicalMinuteParticipant.deleteMany({ where: { minuteId: id } });
                if (participantsToCreate.length > 0) {
                  await tx.pedagogicalMinuteParticipant.createMany({ data: participantsToCreate });
                }
              }

              if (Array.isArray(rawBody.actionItems)) {
                const validActions = rawBody.actionItems.filter(
                  (a: any) => a && typeof a.description === "string" && a.description.trim().length >= 2
                );
                await tx.pedagogicalActionItem.deleteMany({ where: { minuteId: id } });
                if (validActions.length > 0) {
                  await tx.pedagogicalActionItem.createMany({
                    data: validActions.map((a: any) => ({
                      minuteId: id,
                      description: a.description.trim(),
                      responsible: a.responsible || "FAMILIA",
                      dueDate: a.dueDate && String(a.dueDate).trim() !== "" ? new Date(a.dueDate) : null,
                      status: a.status || "PENDING",
                    })),
                  });
                }
              }

              const nextSubject =
                typeof rawBody.subject === "string" && rawBody.subject.trim().length >= 2
                  ? rawBody.subject.trim()
                  : minute.subject;

              await tx.pedagogicalMinute.update({
                where: { id },
                data: {
                  category: rawBody.category ?? minute.category,
                  isConfidential: typeof rawBody.isConfidential === "boolean" ? rawBody.isConfidential : minute.isConfidential,
                  subject: nextSubject,
                  rawNotes: rawBody.rawNotes !== undefined ? rawBody.rawNotes : minute.rawNotes,
                  summary: typeof rawBody.summary === "string" ? rawBody.summary : minute.summary,
                  agreementsSummary:
                    rawBody.agreementsSummary !== undefined ? rawBody.agreementsSummary : minute.agreementsSummary,
                },
              });
            }

            // 3. Recarrega o estado atualizado da ata para selagem do hash
            const refreshedMinute = await tx.pedagogicalMinute.findUnique({
              where: { id },
              include: {
                students: true,
                participants: true,
                actionItems: true,
              },
            });

            if (!refreshedMinute) {
              throw new Error("NOT_FOUND:Ata pedagógica não encontrada");
            }

            if (!refreshedMinute.summary || refreshedMinute.summary.trim().length < 10) {
              throw new Error("VALIDATION:O texto formal da ata deve ser preenchido (mínimo de 10 caracteres) antes da lavratura oficial.");
            }

            if (refreshedMinute.students.length === 0) {
              throw new Error("VALIDATION:Vincule pelo menos um estudante antes de lavrar.");
            }

            // 4. Numeração atômica com trava contra concorrência
            const lastAta = await tx.pedagogicalMinute.findFirst({
              where: {
                schoolId: refreshedMinute.schoolId,
                year: currentYear,
                ataNumber: { not: null },
              },
              orderBy: { ataNumber: "desc" },
              select: { ataNumber: true },
            });

            const nextAtaNumber = (lastAta?.ataNumber || 0) + 1;
            const verificationCode = generateVerificationCode();
            const now = new Date();

            // Verificação de Lavratura Extemporânea (> 5 dias úteis) para conformidade administrativa
            const businessDays = calculateBusinessDaysDiff(refreshedMinute.attendedAt, now);
            let isExtemporaneous = false;
            let extemporaneousReason: string | null = null;

            if (businessDays > 5) {
              const reason = rawBody?.extemporaneousReason ? String(rawBody.extemporaneousReason).trim() : "";
              if (!reason || reason.length < 5) {
                throw new Error(
                  "VALIDATION:Atendimentos realizados há mais de 5 dias úteis exigem justificativa de lavratura extemporânea para fins de escrituração escolar."
                );
              }
              isExtemporaneous = true;
              extemporaneousReason = reason;
            } else if (rawBody?.extemporaneousReason && String(rawBody.extemporaneousReason).trim().length >= 5) {
              isExtemporaneous = true;
              extemporaneousReason = String(rawBody.extemporaneousReason).trim();
            }

            const canonicalPayload = {
              schoolId: refreshedMinute.schoolId,
              year: currentYear,
              ataNumber: nextAtaNumber,
              attendedAt: refreshedMinute.attendedAt.toISOString(),
              category: refreshedMinute.category,
              isConfidential: refreshedMinute.isConfidential,
              isExtemporaneous,
              extemporaneousReason,
              subject: refreshedMinute.subject,
              summary: refreshedMinute.summary,
              agreementsSummary: refreshedMinute.agreementsSummary,
              authorEmail: authCheck.email,
              students: refreshedMinute.students.map((s) => ({
                studentId: s.studentId,
                name: s.studentNameSnapshot,
                className: s.classNameSnapshot,
                cgm: s.cgmSnapshot,
              })),
              participants: refreshedMinute.participants.map((p) => ({
                role: p.role,
                name: p.name,
                documentType: p.documentType,
                documentNumber: p.documentNumber,
                signatureMode: p.signatureMode,
                signatureData: p.signatureData,
                biometricStrokeData: p.biometricStrokeData,
                biometricVerified: p.biometricVerified,
                verifiedEmail: p.verifiedEmail,
                refusalReason: p.refusalReason,
              })),
              actionItems: refreshedMinute.actionItems.map((a) => ({
                description: a.description,
                responsible: a.responsible,
                dueDate: a.dueDate ? a.dueDate.toISOString() : null,
              })),
            };

            const contentHash = computeMinuteHash(canonicalPayload);

            return await tx.pedagogicalMinute.update({
              where: { id },
              data: {
                year: currentYear,
                ataNumber: nextAtaNumber,
                status: "FINALIZED",
                finalizedAt: now,
                contentHash,
                verificationCode,
                isExtemporaneous,
                extemporaneousReason,
                authorId: authCheck.userId,
                authorName: authCheck.userName || refreshedMinute.authorName,
                authorEmail: authCheck.email,
                authorRole: authCheck.role || "PEDAGOGA",
                authorIp: ip,
              },
              include: {
                students: true,
                participants: true,
                actionItems: true,
                addendums: { orderBy: { createdAt: "asc" } },
              },
            });
          },
          { maxWait: 10000, timeout: 20000 }
        );
        break;
      } catch (txErr: any) {
        lastTxError = txErr;
        if (txErr?.code === "P2002" && attempt < 3) {
          continue;
        }
        throw txErr;
      }
    }

    if (!finalized) {
      throw lastTxError || new Error("Não foi possível concluir a transação de lavratura.");
    }

    if (isAlreadyFinalized) {
      return NextResponse.json({ success: true, minute: finalized, alreadyFinalized: true });
    }

    await logAudit({
      action: "FINALIZE_ATA",
      entityType: "PedagogicalMinute",
      entityId: id,
      details: `Lavratura oficial da Ata nº ${String(finalized.ataNumber).padStart(3, "0")}/${finalized.year} (${finalized.subject}) — Hash SHA-256: ${finalized.contentHash?.slice(0, 16)}...`,
      schoolId: finalized.schoolId,
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      ipAddress: ip,
    });

    return NextResponse.json({ success: true, minute: finalized });
  } catch (error: any) {
    console.error("[POST /api/atas/[id]/finalize] Erro:", error);
    const msg = error.message || "";
    if (msg.startsWith("NOT_FOUND:")) {
      return NextResponse.json({ error: msg.replace("NOT_FOUND:", "") }, { status: 404 });
    }
    if (msg.startsWith("FORBIDDEN:")) {
      return NextResponse.json({ error: msg.replace("FORBIDDEN:", "") }, { status: 403 });
    }
    if (msg.startsWith("STATUS_INVALID:") || msg.startsWith("VALIDATION:")) {
      return NextResponse.json({ error: msg.replace(/^(STATUS_INVALID|VALIDATION):/, "") }, { status: 400 });
    }
    return NextResponse.json({ error: msg || "Erro ao lavrar ata" }, { status: 500 });
  }
}
