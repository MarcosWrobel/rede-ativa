import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requireAuth } from "@/lib/permissions";
import { ensureDefaultSchool } from "@/lib/currentSchool";
import { formatZodError, sereBatchImportSchema } from "@/lib/schemas";
import { normalizeStudentName } from "@/lib/studentMatcher";
import { cleanSerePhone } from "@/lib/sereParser";
import { safeQueryList } from "@/lib/safePhase3Queries";

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

    // 1. Resolve escola ativa (e atualiza nome/cidade se solicitado por ADMIN)
    let schoolRecord = await ensureDefaultSchool();
    if (
      schoolRecord &&
      options.updateSchoolInfo &&
      options.schoolInfo?.name &&
      authCheck.role === "ADMIN"
    ) {
      try {
        schoolRecord = await prisma.school.update({
          where: { id: schoolRecord.id },
          data: {
            name: options.schoolInfo.name.trim(),
            ...(options.schoolInfo.city?.trim()
              ? { city: options.schoolInfo.city.trim() }
              : {}),
          },
        });
      } catch (err) {
        console.warn("[students/import] Aviso ao atualizar dados da escola:", err);
      }
    }
    const schoolId = schoolRecord?.id || null;

    // 2. Sincroniza Turmas (ClassGroups)
    const existingClassGroups = await prisma.classGroup.findMany();
    const existingByName = new Map(
      existingClassGroups.map((cg) => [cg.name.trim().toUpperCase(), cg])
    );

    const tempIdToClassId = new Map<string, string>();
    let turmasCreated = 0;
    let turmasUpdated = 0;

    for (const t of turmas) {
      const cleanName = t.name.replace(/\s+/g, " ").trim();
      const upperKey = cleanName.toUpperCase();
      const found = existingByName.get(upperKey);

      if (found) {
        if (
          found.segment !== t.segment ||
          found.shift !== t.shift ||
          (!found.schoolId && schoolId)
        ) {
          const updatedCg = await prisma.classGroup.update({
            where: { id: found.id },
            data: {
              segment: t.segment,
              shift: t.shift,
              ...(schoolId && !found.schoolId ? { schoolId } : {}),
            },
          });
          existingByName.set(upperKey, updatedCg);
          turmasUpdated++;
        }
        tempIdToClassId.set(t.tempId, found.id);
      } else {
        const createdCg = await prisma.classGroup.create({
          data: {
            name: cleanName,
            segment: t.segment,
            shift: t.shift,
            ...(schoolId ? { schoolId } : {}),
          },
        });
        existingByName.set(upperKey, createdCg);
        tempIdToClassId.set(t.tempId, createdCg.id);
        turmasCreated++;
      }
    }

    // 3. Carrega todos os alunos existentes (ativos e inativos) para evitar colisão de @unique cgm
    const allExistingStudents = await prisma.student.findMany({
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
    });

    type ExistingRow = (typeof allExistingStudents)[number];
    const byCgm = new Map<string, ExistingRow>();
    const byNormName = new Map<string, ExistingRow[]>();
    const usedCgms = new Set<string>();

    for (const s of allExistingStudents) {
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
      schoolId?: string | null;
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
        schoolId?: string | null;
        active?: boolean;
      };
    }> = [];

    let cgmsBound = 0;
    let reactivatedCount = 0;
    let movedTurmaCount = 0;
    let skippedExistingCount = 0;

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

        let nextCgm = matched.cgm;
        if (!matched.cgm && cleanCgm && !usedCgms.has(cleanCgm)) {
          nextCgm = cleanCgm;
          usedCgms.add(cleanCgm);
          cgmsBound++;
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
          nextCgm !== matched.cgm ||
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
              cgm: nextCgm,
              phone: nextPhone,
              guardianName: nextGuardian,
              classGroupId: targetClassGroupId,
              active: true,
              ...(needsSchoolBind ? { schoolId } : {}),
            },
          });
        } else {
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
          ...(schoolId ? { schoolId } : {}),
          active: true,
        });
      }
    }

    // 5. Inserção em lote de novos alunos
    let createdCount = 0;
    const CREATE_CHUNK = 250;
    for (let i = 0; i < toCreate.length; i += CREATE_CHUNK) {
      const slice = toCreate.slice(i, i + CREATE_CHUNK);
      const res = await prisma.student.createMany({
        data: slice,
        skipDuplicates: true,
      });
      createdCount += res.count;
    }

    // 6. Atualização transacional em blocos de alunos existentes modificados
    const UPDATE_CHUNK = 100;
    for (let i = 0; i < toUpdate.length; i += UPDATE_CHUNK) {
      const slice = toUpdate.slice(i, i + UPDATE_CHUNK);
      await prisma.$transaction(
        slice.map((u) =>
          prisma.student.update({
            where: { id: u.id },
            data: u.data,
          })
        )
      );
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
        const res = await prisma.student.updateMany({
          where: { id: { in: Array.from(idsToDeactivate) } },
          data: { active: false },
        });
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
        updatedCount: toUpdate.length,
        movedTurmaCount,
        reactivatedCount,
        cgmsBound,
        deactivatedTransferredCount,
        missingPhoneImportedCount,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    // 9. Retorna listas atualizadas prontas para hidratar a tela /alunos sem reload
    const recentCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const [freshStudents, freshClassGroups, recentJustifications, allContacts] =
      await Promise.all([
        prisma.student.findMany({
          where: { active: true },
          include: {
            classGroup: true,
            _count: { select: { messageLogs: true } },
          },
          orderBy: [{ classGroup: { name: "asc" } }, { name: "asc" }],
        }),
        prisma.classGroup.findMany({
          orderBy: { name: "asc" },
        }),
        safeQueryList(() =>
          prisma.absenceJustification.findMany({
            where: { endDate: { gte: recentCutoff } },
            orderBy: { endDate: "desc" },
          })
        ),
        safeQueryList(() =>
          prisma.studentContact.findMany({
            select: { id: true, studentId: true, whatsappValid: true },
          })
        ),
      ]);

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
        updatedCount: toUpdate.length,
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
    console.error("[students/import] Erro ao importar lote do SERE:", error);
    return NextResponse.json(
      { error: error.message || "Erro interno ao processar o lote de alunos." },
      { status: 500 }
    );
  }
}
