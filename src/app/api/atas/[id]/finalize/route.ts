import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { logAudit, extractClientIp } from "@/lib/audit";
import { computeMinuteHash, generateVerificationCode } from "@/lib/ataCrypto";

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

    // Consulta ata atual
    let minute = await prisma.pedagogicalMinute.findUnique({
      where: { id },
      include: {
        students: true,
        participants: true,
        actionItems: true,
      },
    });

    if (!minute) {
      return NextResponse.json({ error: "Ata pedagógica não encontrada" }, { status: 404 });
    }

    // Idempotência: se já foi lavrada (ex: duplo clique), retorna a ata oficial já lavrada
    if (minute.status === "FINALIZED") {
      return NextResponse.json({ success: true, minute, alreadyFinalized: true });
    }

    if (minute.status !== "DRAFT") {
      return NextResponse.json(
        { error: `Esta ata encontra-se com status '${minute.status}' e não pode ser lavrada.` },
        { status: 400 }
      );
    }

    // Se o cliente enviou os dados atualizados do formulário no momento de lavrar, sincroniza antes de selar o hash
    if (rawBody && typeof rawBody === "object") {
      if (Array.isArray(rawBody.studentIds) && rawBody.studentIds.length > 0) {
        const studentsDb = await prisma.student.findMany({
          where: { id: { in: rawBody.studentIds } },
          include: { classGroup: true },
        });
        if (studentsDb.length > 0) {
          await prisma.pedagogicalMinuteStudent.deleteMany({ where: { minuteId: id } });
          await prisma.pedagogicalMinuteStudent.createMany({
            data: studentsDb.map((s) => ({
              minuteId: id,
              studentId: s.id,
              studentNameSnapshot: s.name,
              classNameSnapshot: s.classGroup?.name || null,
              cgmSnapshot: s.cgm || null,
            })),
          });
        }
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

          const bioVerified = shouldClear || isRefused ? false : (p.biometricVerified ?? match?.biometricVerified ?? false);
          const bioDevice = shouldClear || isRefused ? null : (p.biometricDeviceType || match?.biometricDeviceType || null);
          const bioTime = bioVerified ? (match?.biometricAuthTime || new Date()) : null;

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
            signatureMode: sigMode,
            signatureData: sigData,
            signedAt,
            signerIp: shouldClear || isRefused ? null : (match?.signerIp || null),
            mobileSignToken: null,
            mobileSignExpiresAt: null,
            biometricVerified: bioVerified,
            biometricDeviceType: bioDevice,
            biometricAuthTime: bioTime,
            refusalReason: isRefused ? (p.refusalReason || null) : null,
            witnessName: isRefused ? (p.witnessName || null) : null,
          };
        });

        await prisma.pedagogicalMinuteParticipant.deleteMany({ where: { minuteId: id } });
        if (participantsToCreate.length > 0) {
          await prisma.pedagogicalMinuteParticipant.createMany({ data: participantsToCreate });
        }
      }

      if (Array.isArray(rawBody.actionItems)) {
        const validActions = rawBody.actionItems.filter(
          (a: any) => a && typeof a.description === "string" && a.description.trim().length >= 2
        );
        await prisma.pedagogicalActionItem.deleteMany({ where: { minuteId: id } });
        if (validActions.length > 0) {
          await prisma.pedagogicalActionItem.createMany({
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

      minute = await prisma.pedagogicalMinute.update({
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
        include: {
          students: true,
          participants: true,
          actionItems: true,
        },
      });
    }

    if (!minute.summary || minute.summary.trim().length < 10) {
      return NextResponse.json(
        { error: "O texto formal da ata deve ser preenchido (mínimo de 10 caracteres) antes da lavratura oficial." },
        { status: 400 }
      );
    }

    if (minute.students.length === 0) {
      return NextResponse.json({ error: "Vincule pelo menos um estudante antes de lavrar." }, { status: 400 });
    }

    const currentYear = new Date().getFullYear();

    // Executa em transação com timeout estendido (Neon Serverless) e retry contra colisão de numeração simultânea
    let finalized: any = null;
    let lastTxError: any = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        finalized = await prisma.$transaction(
          async (tx) => {
            const lastAta = await tx.pedagogicalMinute.findFirst({
              where: {
                schoolId: minute!.schoolId,
                year: currentYear,
                ataNumber: { not: null },
              },
              orderBy: { ataNumber: "desc" },
              select: { ataNumber: true },
            });

            const nextAtaNumber = (lastAta?.ataNumber || 0) + 1;
            const verificationCode = generateVerificationCode();
            const now = new Date();

            const canonicalPayload = {
              schoolId: minute!.schoolId,
              year: currentYear,
              ataNumber: nextAtaNumber,
              attendedAt: minute!.attendedAt.toISOString(),
              category: minute!.category,
              subject: minute!.subject,
              summary: minute!.summary,
              agreementsSummary: minute!.agreementsSummary,
              authorEmail: authCheck.email,
              students: minute!.students.map((s) => ({
                studentId: s.studentId,
                name: s.studentNameSnapshot,
                className: s.classNameSnapshot,
                cgm: s.cgmSnapshot,
              })),
              participants: minute!.participants.map((p) => ({
                role: p.role,
                name: p.name,
                documentType: p.documentType,
                documentNumber: p.documentNumber,
                signatureMode: p.signatureMode,
                signatureData: p.signatureData,
                biometricVerified: p.biometricVerified,
                refusalReason: p.refusalReason,
              })),
              actionItems: minute!.actionItems.map((a) => ({
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
                authorId: authCheck.userId,
                authorName: authCheck.userName || minute!.authorName,
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
        // Se houve colisão de unique constraint (P2002) em concorrência, tenta próximo número
        if (txErr?.code === "P2002" && attempt < 3) {
          continue;
        }
        throw txErr;
      }
    }

    if (!finalized) {
      throw lastTxError || new Error("Não foi possível concluir a transação de lavratura.");
    }

    await logAudit({
      action: "FINALIZE_ATA",
      entityType: "PedagogicalMinute",
      entityId: id,
      details: `Lavratura oficial da Ata nº ${String(finalized.ataNumber).padStart(3, "0")}/${finalized.year} (${finalized.subject}) — Hash SHA-256: ${finalized.contentHash?.slice(0, 16)}...`,
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
    return NextResponse.json({ error: error.message || "Erro ao lavrar ata" }, { status: 500 });
  }
}
