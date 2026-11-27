import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requireAuth, checkIsSuperAdmin } from "@/lib/permissions";
import { formatZodError, sereBatchImportSchema } from "@/lib/schemas";
import {
  canMutateSchoolCouncil,
  resolveAuthorizedSchoolForCouncil,
  resolveExplicitSelectedSchoolForCouncil,
} from "@/services/classCouncilService";
import { normalizeStudentName } from "@/lib/studentMatcher";
import { cleanSerePhone, resolveSereTurmaMatch } from "@/lib/sereParser";
import { safeQueryList } from "@/lib/safePhase3Queries";
import { applyPendingCgmUpdatesSafely } from "@/lib/syncCgmGuard";
import { withTenantContext } from "@/lib/rlsTenantContext";
import {
  acquireClassGroupSchoolLock,
  isPrismaUniqueConstraintError,
  normalizeClassGroupDisplayName,
  normalizeClassGroupKey,
} from "@/lib/classGroupName";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const rawBody = await req.json();
    const parsed = sereBatchImportSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const { turmas, students, transferredStudents, options } = parsed.data;

    // 1. Resolve escola ativa com seleção explícita para SuperAdmin e permissão de escrita na escola alvo
    const currentSchool = checkIsSuperAdmin(authCheck.session)
      ? await resolveExplicitSelectedSchoolForCouncil(
          authCheck.session,
          authCheck.schoolId
        )
      : await resolveAuthorizedSchoolForCouncil(
          authCheck.session,
          authCheck.schoolId
        );
    if (!currentSchool) {
      return NextResponse.json(
        { error: "Nenhuma instituição escolar autorizada selecionada na sessão atual." },
        { status: 403 }
      );
    }
    if (!canMutateSchoolCouncil(authCheck.session, currentSchool.id)) {
      return NextResponse.json(
        { error: "Sem permissão de escrita para importar estudantes nesta escola." },
        { status: 403 }
      );
    }

    // RBAC Guard: apenas SuperAdmin pode atualizar dados cadastrais da instituição (Ponto 5)
    if (options.updateSchoolInfo && !checkIsSuperAdmin(authCheck.session)) {
      return NextResponse.json(
        { error: "Apenas administradores globais podem atualizar dados cadastrais da instituição escolar." },
        { status: 403 }
      );
    }

    const schoolId: string = currentSchool.id;
    const schoolFilter = { schoolId };

    // 2. Sincroniza Turmas (ClassGroups) e carrega alunos existentes isolados por escola em withTenantContext
    const tempIdToClassId = new Map<string, string>();
    let turmasCreated = 0;
    let turmasUpdated = 0;

    const incomingCgms = Array.from(
      new Set(
        students
          .map((s) => (s.cgm || "").replace(/\D/g, "").trim())
          .filter((cgm) => cgm.length > 0)
      )
    );

    const [txImportState, globalCgmRows] = await Promise.all([
      withTenantContext(prisma, schoolId, async (tx) => {
        await acquireClassGroupSchoolLock(tx, schoolId);

        const [existingClassGroups, schoolStudents] = await Promise.all([
          tx.classGroup.findMany({
            where: schoolFilter,
          }),
          tx.student.findMany({
            where: schoolFilter,
            select: {
              id: true,
              cgm: true,
              name: true,
              guardianName: true,
              phone: true,
              classGroupId: true,
              schoolId: true,
              active: true,
            },
          }),
        ]);

        const existingById = new Map(existingClassGroups.map((cg) => [cg.id, cg]));
        const existingStudentsByCgm = new Map<string, { classGroupId: string }>();
        for (const st of schoolStudents) {
          const clean = (st.cgm || "").replace(/\D/g, "").trim();
          if (clean) {
            existingStudentsByCgm.set(clean, { classGroupId: st.classGroupId });
          }
        }

        const cgmsByTempId = new Map<string, string[]>();
        for (const s of students) {
          const clean = (s.cgm || "").replace(/\D/g, "").trim();
          if (!clean) continue;
          const list = cgmsByTempId.get(s.turmaTempId) || [];
          list.push(clean);
          cgmsByTempId.set(s.turmaTempId, list);
        }

        const seenNewCanonicalKeys = new Set<string>();
        const ambiguousTurmas: Array<{
          tempId: string;
          name: string;
          reason?: string;
          candidates: Array<{ id: string; name: string; segment: string; shift: string }>;
        }> = [];
        const plannedTurmas: Array<{
          turma: (typeof turmas)[number];
          cleanName: string;
          upperKey: string;
          matchedClassGroup?: (typeof existingClassGroups)[number];
        }> = [];

        for (const t of turmas) {
          const cleanName = normalizeClassGroupDisplayName(t.name);
          const upperKey = normalizeClassGroupKey(cleanName);

          if (t.targetClassGroupId) {
            const explicitTarget = existingById.get(t.targetClassGroupId);
            if (!explicitTarget) {
              return {
                errorStatus: 400 as const,
                error: "Turma selecionada não encontrada nesta instituição escolar.",
              };
            }
            plannedTurmas.push({
              turma: t,
              cleanName,
              upperKey,
              matchedClassGroup: explicitTarget,
            });
            continue;
          }

          if (t.confirmCreateNew) {
            const canonicalConflict = existingClassGroups.find(
              (cg) => normalizeClassGroupKey(cg.name) === upperKey
            );
            if (canonicalConflict) {
              return {
                errorStatus: 409 as const,
                error: `Já existe uma turma com o nome "${cleanName}" nesta escola.`,
              };
            }
            if (seenNewCanonicalKeys.has(upperKey)) {
              return {
                errorStatus: 409 as const,
                error: `Já existe uma turma com o nome "${cleanName}" no lote de importação.`,
              };
            }
            seenNewCanonicalKeys.add(upperKey);
            plannedTurmas.push({
              turma: t,
              cleanName,
              upperKey,
            });
            continue;
          }

          const resolution = resolveSereTurmaMatch({
            name: cleanName,
            shift: t.shift,
            sourceIdentity: t.sourceIdentity,
            studentCgms: cgmsByTempId.get(t.tempId) || [],
            existingClassGroups,
            existingStudentsByCgm,
          });

          if (resolution.status === "ambiguous") {
            ambiguousTurmas.push({
              tempId: t.tempId,
              name: cleanName,
              reason: resolution.reason,
              candidates: resolution.candidates,
            });
            continue;
          }

          if (resolution.status === "matched" && resolution.matchedClassGroupId) {
            const matched = existingById.get(resolution.matchedClassGroupId);
            plannedTurmas.push({
              turma: t,
              cleanName,
              upperKey,
              matchedClassGroup: matched,
            });
            continue;
          }

          if (seenNewCanonicalKeys.has(upperKey)) {
            return {
              errorStatus: 409 as const,
              error: `Já existe uma turma com o nome "${cleanName}" no lote de importação.`,
            };
          }
          seenNewCanonicalKeys.add(upperKey);
          plannedTurmas.push({
            turma: t,
            cleanName,
            upperKey,
          });
        }

        if (ambiguousTurmas.length > 0) {
          return {
            errorStatus: 409 as const,
            error:
              "Existem turmas com correspondência ambígua na escola. Selecione a turma de destino antes de importar.",
            code: "AMBIGUOUS_CLASS_GROUP",
            ambiguousTurmas,
          };
        }

        if (
          options.updateSchoolInfo &&
          options.schoolInfo?.name &&
          checkIsSuperAdmin(authCheck.session)
        ) {
          await tx.school.update({
            where: { id: schoolId },
            data: {
              name: options.schoolInfo.name.trim(),
              ...(options.schoolInfo.city?.trim()
                ? { city: options.schoolInfo.city.trim() }
                : {}),
            },
          });
        }

        for (const plan of plannedTurmas) {
          const { turma: t, cleanName, matchedClassGroup: found } = plan;
          if (found) {
            if (
              found.segment !== t.segment ||
              found.shift !== t.shift ||
              (!found.schoolId && schoolId)
            ) {
              await tx.classGroup.update({
                where: { id: found.id },
                data: {
                  segment: t.segment,
                  shift: t.shift,
                  ...(schoolId && !found.schoolId ? { schoolId } : {}),
                },
              });
              turmasUpdated++;
            }
            tempIdToClassId.set(t.tempId, found.id);
          } else {
            const createdCg = await tx.classGroup.create({
              data: {
                name: cleanName,
                segment: t.segment,
                shift: t.shift,
                schoolId,
              },
            });
            tempIdToClassId.set(t.tempId, createdCg.id);
            turmasCreated++;
          }
        }

        return { errorStatus: null, schoolStudents };
      }),
      // Exceção explícita da Fase A: consulta global mínima apenas de CGMs ocupados (@unique cgm)
      incomingCgms.length > 0
        ? prisma.student.findMany({
            where: { cgm: { in: incomingCgms } },
            select: { id: true, cgm: true, schoolId: true },
          })
        : Promise.resolve([]),
    ]);

    if (txImportState.errorStatus !== null) {
      return NextResponse.json(
        {
          error: txImportState.error,
          ...("code" in txImportState ? { code: txImportState.code } : {}),
          ...("ambiguousTurmas" in txImportState
            ? { ambiguousTurmas: txImportState.ambiguousTurmas }
            : {}),
        },
        { status: txImportState.errorStatus }
      );
    }

    const existingSchoolStudents = txImportState.schoolStudents;

    type ExistingRow = (typeof existingSchoolStudents)[number];
    const byCgm = new Map<string, ExistingRow>();
    const byNormName = new Map<string, ExistingRow[]>();
    const usedCgms = new Set<string>();

    // Mapeia IDs dos alunos desta escola para isolar colisões externas
    const thisSchoolStudentIds = new Set(existingSchoolStudents.map((s) => s.id));

    // Apenas marca como usedCgms os CGMs pertencentes a OUTROS estudantes de OUTRAS escolas
    for (const row of globalCgmRows) {
      const c = row.cgm?.trim();
      if (c && !thisSchoolStudentIds.has(row.id)) {
        usedCgms.add(c);
      }
    }

    for (const s of existingSchoolStudents) {
      const cgmTrim = s.cgm?.trim();
      if (cgmTrim) {
        byCgm.set(cgmTrim, s);
        usedCgms.add(cgmTrim);
      }
      const norm = normalizeStudentName(s.name);
      if (norm) {
        const list = byNormName.get(norm) || [];
        list.push(s);
        byNormName.set(norm, list);
      }
    }

    const processedIds = new Set<string>();
    const toCreate: Array<{
      cgm: string | null;
      name: string;
      guardianName: string;
      phone: string;
      classGroupId: string;
      schoolId: string;
      active: boolean;
    }> = [];

    const toUpdate: Array<{
      id: string;
      data: {
        cgm?: string | null;
        name?: string;
        guardianName?: string | null;
        phone?: string;
        classGroupId?: string;
        schoolId?: string;
        active?: boolean;
      };
    }> = [];

    let cgmsBound = 0;
    let reactivatedCount = 0;
    let movedTurmaCount = 0;
    let skippedExistingCount = 0;
    const pendingCgmUpdates = new Map<string, string>();

    // 4. Pareamento em memória O(N)
    for (const item of students) {
      const targetClassGroupId = tempIdToClassId.get(item.turmaTempId);
      if (!targetClassGroupId) continue;

      const cleanCgm = (item.cgm || "").replace(/\D/g, "");
      const cleanPhone = cleanSerePhone(item.phone);
      const formattedName = item.name.replace(/\s+/g, " ").trim().toUpperCase();
      const normName = normalizeStudentName(formattedName);

      let matched: ExistingRow | undefined =
        cleanCgm && byCgm.has(cleanCgm) ? byCgm.get(cleanCgm) : undefined;

      if (!matched && normName) {
        const candidates = (byNormName.get(normName) || []).filter(
          (c) => !processedIds.has(c.id) && (!c.cgm || !cleanCgm || c.cgm === cleanCgm)
        );
        if (candidates.length > 0) {
          // Prioriza candidato ativo e na mesma turma
          candidates.sort((a, b) => {
            const scoreA = (a.active ? 2 : 0) + (a.classGroupId === targetClassGroupId ? 1 : 0);
            const scoreB = (b.active ? 2 : 0) + (b.classGroupId === targetClassGroupId ? 1 : 0);
            return scoreB - scoreA;
          });
          matched = candidates[0];
        }
      }

      if (matched) {
        processedIds.add(matched.id);

        if (!options.updateExisting) {
          skippedExistingCount++;
          continue;
        }

        if (!matched.cgm && cleanCgm && !usedCgms.has(cleanCgm)) {
          pendingCgmUpdates.set(matched.id, cleanCgm);
          usedCgms.add(cleanCgm);
        }

        const nextPhone = cleanPhone || matched.phone || "";
        const incomingGuardian = item.guardianName?.trim();
        const nextGuardian =
          incomingGuardian && incomingGuardian !== "Responsável"
            ? incomingGuardian
            : matched.guardianName || "Responsável";

        const changedClass = matched.classGroupId !== targetClassGroupId;
        const wasInactive = !matched.active;
        const needsSchoolBind = Boolean(schoolId && !matched.schoolId);

        if (
          nextPhone !== matched.phone ||
          nextGuardian !== matched.guardianName ||
          changedClass ||
          wasInactive ||
          needsSchoolBind
        ) {
          if (changedClass) movedTurmaCount++;
          if (wasInactive) reactivatedCount++;

          toUpdate.push({
            id: matched.id,
            data: {
              phone: nextPhone,
              guardianName: nextGuardian,
              classGroupId: targetClassGroupId,
              active: true,
              ...(needsSchoolBind ? { schoolId } : {}),
            },
          });
        } else if (!pendingCgmUpdates.has(matched.id)) {
          skippedExistingCount++;
        }
      } else {
        const finalCgm = cleanCgm && !usedCgms.has(cleanCgm) ? cleanCgm : null;
        if (finalCgm) usedCgms.add(finalCgm);

        toCreate.push({
          cgm: finalCgm,
          name: formattedName,
          guardianName: item.guardianName?.trim() || "Responsável",
          phone: cleanPhone,
          classGroupId: targetClassGroupId,
          schoolId,
          active: true,
        });
      }
    }

    // 5. Inserção em lote de novos alunos
    let createdCount = 0;
    const CREATE_CHUNK = 250;
    for (let i = 0; i < toCreate.length; i += CREATE_CHUNK) {
      const slice = toCreate.slice(i, i + CREATE_CHUNK);
      const res = await withTenantContext(prisma, schoolId, async (tx) =>
        tx.student.createMany({
          data: slice,
          skipDuplicates: true,
        })
      );
      createdCount += res.count;
    }

    // 6. Atualização transacional em blocos de alunos existentes modificados
    const UPDATE_CHUNK = 100;
    for (let i = 0; i < toUpdate.length; i += UPDATE_CHUNK) {
      const slice = toUpdate.slice(i, i + UPDATE_CHUNK);
      await withTenantContext(prisma, schoolId, async (tx) => {
        for (const u of slice) {
          await tx.student.updateMany({
            where: { id: u.id, schoolId },
            data: u.data,
          });
        }
      });
    }

    // 6b. Vinculação resiliente de CGMs pendentes (blindada contra colisão concorrente P2002)
    if (pendingCgmUpdates.size > 0) {
      cgmsBound = await applyPendingCgmUpdatesSafely(prisma as any, pendingCgmUpdates, schoolId);
    }

    // 7. Inativação opcional de alunos Transferidos / Desistentes no SERE
    let deactivatedTransferredCount = 0;
    if (options.deactivateTransferred && transferredStudents.length > 0) {
      const idsToDeactivate = new Set<string>();

      for (const tr of transferredStudents) {
        const trCgm = (tr.cgm || "").replace(/\D/g, "");
        const trNorm = normalizeStudentName(tr.name);

        let target: ExistingRow | undefined = trCgm ? byCgm.get(trCgm) : undefined;
        if (!target && trNorm) {
          const candidates = (byNormName.get(trNorm) || []).filter(
            (c) => c.active && !processedIds.has(c.id)
          );
          if (candidates.length === 1) {
            target = candidates[0];
          }
        }

        if (target && target.active && !processedIds.has(target.id)) {
          idsToDeactivate.add(target.id);
        }
      }

      if (idsToDeactivate.size > 0) {
        const res = await withTenantContext(prisma, schoolId, async (tx) =>
          tx.student.updateMany({
            where: {
              id: { in: Array.from(idsToDeactivate) },
              schoolId,
            },
            data: { active: false },
          })
        );
        deactivatedTransferredCount = res.count;
      }
    }

    const missingPhoneImportedCount = toCreate.filter((s) => !s.phone).length;

    // 8. Registra na Trilha de Auditoria
    await logAudit({
      action: "IMPORT_STUDENTS_SERE",
      entityType: "Student",
      entityId: "SERE_BATCH",
      details: {
        turmasReceived: turmas.length,
        turmasCreated,
        turmasUpdated,
        studentsReceived: students.length,
        createdCount,
        updatedCount: new Set([...toUpdate.map((u) => u.id), ...pendingCgmUpdates.keys()]).size,
        movedTurmaCount,
        reactivatedCount,
        cgmsBound,
        deactivatedTransferredCount,
        missingPhoneImportedCount,
      },
      schoolId: schoolId,
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    // 9. Retorna listas atualizadas prontas para hidratar a tela /alunos sem reload (ISOLADAS POR ESCOLA)
    const recentCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const { freshStudents, freshClassGroups, recentJustifications, allContacts } =
      await withTenantContext(prisma, schoolId, async (tx) => {
        const sRows = await tx.student.findMany({
          where: {
            active: true,
            schoolId,
            classGroup: { schoolId },
          },
          include: {
            classGroup: true,
            _count: {
              select: {
                messageLogs: { where: { OR: [{ schoolId: null }, { schoolId }] } },
              },
            },
          },
          orderBy: [{ classGroup: { name: "asc" } }, { name: "asc" }],
        });
        const cgRows = await tx.classGroup.findMany({
          where: schoolFilter,
          orderBy: { name: "asc" },
        });
        const justRows = await safeQueryList(() =>
          tx.absenceJustification.findMany({
            where: {
              endDate: { gte: recentCutoff },
              student: { schoolId },
            },
            orderBy: { endDate: "desc" },
          })
        );
        const contactRows = await safeQueryList(() =>
          tx.studentContact.findMany({
            where: { student: { schoolId } },
            select: { id: true, studentId: true, whatsappValid: true },
          })
        );
        return {
          freshStudents: sRows,
          freshClassGroups: cgRows,
          recentJustifications: justRows,
          allContacts: contactRows,
        };
      });

    const justMap = new Map<string, any[]>();
    recentJustifications.forEach((j: any) => {
      const arr = justMap.get(j.studentId) || [];
      arr.push(j);
      justMap.set(j.studentId, arr);
    });

    const contactsCountMap = new Map<string, number>();
    allContacts.forEach((c: any) => {
      contactsCountMap.set(c.studentId, (contactsCountMap.get(c.studentId) || 0) + 1);
    });

    const enrichedStudents = freshStudents.map((s) => ({
      ...s,
      justifications: justMap.get(s.id) || [],
      extraContactsCount: contactsCountMap.get(s.id) || 0,
    }));

    return NextResponse.json({
      success: true,
      summary: {
        turmasCreated,
        turmasUpdated,
        createdCount,
        updatedCount: new Set([...toUpdate.map((u) => u.id), ...pendingCgmUpdates.keys()]).size,
        movedTurmaCount,
        reactivatedCount,
        cgmsBound,
        skippedExistingCount,
        deactivatedTransferredCount,
        missingPhoneImportedCount,
      },
      students: enrichedStudents,
      classGroups: freshClassGroups,
    });
  } catch (error: any) {
    if (isPrismaUniqueConstraintError(error)) {
      return NextResponse.json(
        { error: "Já existe uma turma com este nome nesta escola." },
        { status: 409 }
      );
    }
    console.error("[students/import] Erro ao importar lote do SERE:", error);
    return NextResponse.json(
      { error: "Erro interno ao processar o lote de alunos." },
      { status: 500 }
    );
  }
}
