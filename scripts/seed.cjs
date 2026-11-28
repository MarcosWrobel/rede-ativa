const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

function resolveCliArg(prefix) {
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : '';
}

function validateAndParseSeedPayload(resolvedDataPath, targetSchool, options = {}) {
  const replaceSchoolLogs = options.replaceSchoolLogs === true;
  if (!fs.existsSync(resolvedDataPath)) {
    throw new Error(`SEED_DATA_FILE_NOT_FOUND: arquivo não encontrado (${resolvedDataPath}).`);
  }

  const rawData = fs.readFileSync(resolvedDataPath, 'utf-8');
  if (!rawData || !rawData.trim()) {
    throw new Error('SEED_DATA_FILE_EMPTY: arquivo de entrada vazio.');
  }

  let data;
  try {
    data = JSON.parse(rawData);
  } catch {
    throw new Error('SEED_INVALID_JSON: arquivo de entrada não contém JSON válido.');
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('SEED_INVALID_JSON: raiz do arquivo deve ser um objeto JSON.');
  }

  const rootSchoolId = typeof data.sourceSchoolId === 'string' ? data.sourceSchoolId.trim() : '';
  const metaSchoolId = typeof data.meta?.schoolId === 'string' ? data.meta.schoolId.trim() : '';
  const rootInepCode = typeof data.sourceInepCode === 'string' ? data.sourceInepCode.trim() : '';
  const metaInepCode = typeof data.meta?.inepCode === 'string' ? data.meta.inepCode.trim() : '';

  if (rootSchoolId && metaSchoolId && rootSchoolId !== metaSchoolId) {
    throw new Error(
      `SEED_CONTRADICTORY_ORIGIN: sourceSchoolId (${rootSchoolId}) contradiz meta.schoolId (${metaSchoolId}).`
    );
  }

  if (rootInepCode && metaInepCode && rootInepCode !== metaInepCode) {
    throw new Error(
      `SEED_CONTRADICTORY_ORIGIN: sourceInepCode (${rootInepCode}) contradiz meta.inepCode (${metaInepCode}).`
    );
  }

  if (!rootSchoolId && !metaSchoolId && !rootInepCode && !metaInepCode) {
    throw new Error(
      'SEED_UNVERIFIABLE_ORIGIN: arquivo sem metadados de origem escolar (sourceSchoolId/sourceInepCode ou meta).'
    );
  }

  for (const candidateSchoolId of [rootSchoolId, metaSchoolId].filter(Boolean)) {
    if (candidateSchoolId !== targetSchool.id) {
      throw new Error(
        `SEED_ORIGIN_SCHOOL_MISMATCH: origem (${candidateSchoolId}) diverge da escola de destino (${targetSchool.id}).`
      );
    }
  }

  for (const candidateInepCode of [rootInepCode, metaInepCode].filter(Boolean)) {
    if (candidateInepCode !== targetSchool.inepCode) {
      throw new Error(
        `SEED_ORIGIN_INEP_MISMATCH: INEP de origem (${candidateInepCode}) diverge do destino (${targetSchool.inepCode}).`
      );
    }
  }

  const segments = ['FUNDAMENTAL', 'MEDIO', 'NOTURNO'].filter((seg) => data[seg] != null);
  if (segments.length === 0) {
    throw new Error('SEED_EMPTY_PAYLOAD: nenhum segmento válido (FUNDAMENTAL/MEDIO/NOTURNO) informado.');
  }

  let totalRecords = 0;
  let totalLogs = 0;
  for (const seg of segments) {
    const segData = data[seg];
    if (!segData || typeof segData !== 'object' || Array.isArray(segData)) {
      throw new Error(`SEED_INVALID_SEGMENT: segmento ${seg} inválido.`);
    }

    const templates = segData.templates ?? [];
    const students = segData.students ?? [];
    const logs = segData.logs ?? [];
    if (!Array.isArray(templates) || !Array.isArray(students) || !Array.isArray(logs)) {
      throw new Error(`SEED_INVALID_SEGMENT: templates/students/logs de ${seg} devem ser arrays.`);
    }

    for (const t of templates) {
      if (!t || typeof t.title !== 'string' || !t.title.trim()) {
        throw new Error(`SEED_INVALID_RECORD: template inválido em ${seg}.`);
      }
      totalRecords += 1;
    }

    for (const s of students) {
      if (
        !s ||
        typeof s.name !== 'string' ||
        !s.name.trim() ||
        typeof s.phone !== 'string' ||
        !s.phone.trim() ||
        typeof s.turma !== 'string' ||
        !s.turma.trim()
      ) {
        throw new Error(`SEED_INVALID_RECORD: estudante inválido em ${seg}.`);
      }
      totalRecords += 1;
    }

    for (const l of logs) {
      if (
        !l ||
        typeof l.student_name !== 'string' ||
        !l.student_name.trim() ||
        typeof l.reason !== 'string' ||
        !l.reason.trim() ||
        !l.date ||
        Number.isNaN(new Date(l.date).getTime())
      ) {
        throw new Error(`SEED_INVALID_RECORD: log inválido em ${seg}.`);
      }
      totalRecords += 1;
      totalLogs += 1;
    }
  }

  if (totalRecords === 0) {
    throw new Error('SEED_EMPTY_PAYLOAD: arquivo não possui registros para importar.');
  }

  if (replaceSchoolLogs && totalLogs === 0) {
    throw new Error(
      'SEED_REPLACE_LOGS_EMPTY: --replace-school-logs exige pelo menos um log de reposição.'
    );
  }

  return { data, segments };
}

/**
 * Executa o seed escolar estritamente validado e com escopo de tenant (`set_config`).
 * - Exige escola explícita (`schoolId` / `inepCode`) sem seletores conflitantes.
 * - Exige arquivo explícito (`--data-file=` / `SEED_DATA_FILE` / `options.dataPath`) com origem verificável.
 * - Nunca muta `User`, `User.role`, `User.active` ou vínculos `UserSchool`, independentemente dos privilégios da credencial.
 */
async function runSeed(options = {}) {
  const ownPrisma = !options.prismaClient;
  const prisma = options.prismaClient || new PrismaClient();

  try {
    const schoolId = String(
      options.schoolId || process.env.SEED_SCHOOL_ID || resolveCliArg('--school-id=') || ''
    ).trim();
    const inepCode = String(
      options.inepCode || process.env.SEED_SCHOOL_INEP || resolveCliArg('--inep=') || ''
    ).trim();

    if (!schoolId && !inepCode) {
      throw new Error(
        'SEED_EXPLICIT_SCHOOL_REQUIRED: informe schoolId ou inepCode explícito (SEED_SCHOOL_ID / SEED_SCHOOL_INEP / --school-id= / --inep=).'
      );
    }

    const rawDataPath = String(
      options.dataPath || process.env.SEED_DATA_FILE || resolveCliArg('--data-file=') || ''
    ).trim();
    if (!rawDataPath) {
      throw new Error(
        'SEED_EXPLICIT_DATA_FILE_REQUIRED: informe o arquivo explícito (--data-file=... ou SEED_DATA_FILE).'
      );
    }
    const resolvedDataPath = path.resolve(rawDataPath);

    let targetSchool = null;
    if (schoolId && inepCode) {
      const [byId, byInep] = await Promise.all([
        prisma.school.findUnique({ where: { id: schoolId } }),
        prisma.school.findUnique({ where: { inepCode } }),
      ]);
      if (!byId || !byInep || byId.id !== byInep.id) {
        throw new Error(
          `SEED_CONFLICTING_TARGET_SELECTORS: schoolId (${schoolId}) e inepCode (${inepCode}) são conflitantes ou inexistentes.`
        );
      }
      targetSchool = byId;
    } else if (schoolId) {
      targetSchool = await prisma.school.findUnique({ where: { id: schoolId } });
    } else {
      targetSchool = await prisma.school.findUnique({ where: { inepCode } });
    }

    if (!targetSchool || targetSchool.active === false) {
      throw new Error(
        `SEED_SCHOOL_NOT_FOUND_OR_INACTIVE: escola alvo não encontrada ou inativa (${schoolId || inepCode}).`
      );
    }

    const replaceSchoolLogs =
      options.replaceSchoolLogs === true ||
      process.env.SEED_REPLACE_SCHOOL_LOGS === 'true' ||
      process.argv.includes('--replace-school-logs');

    const { data, segments } = validateAndParseSeedPayload(resolvedDataPath, targetSchool, {
      replaceSchoolLogs,
    });

    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_school_id', ${targetSchool.id}, true)`;

        const classGroupMap = {};
        const absenceKeywords = ['FALTOU', 'FALTAS', 'GAZEOU', 'ATRASO', 'ATRASOS'];

        for (const seg of segments) {
          const students = data[seg].students || [];
          const shift = seg === 'NOTURNO' ? 'NOITE' : seg === 'MEDIO' ? 'MANHA' : 'TARDE';

          for (const s of students) {
            const key = `${targetSchool.id}:${seg}:${s.turma}`;
            if (!classGroupMap[key]) {
              const cg = await tx.classGroup.upsert({
                where: { schoolId_name: { schoolId: targetSchool.id, name: s.turma } },
                update: { segment: seg, shift },
                create: { name: s.turma, segment: seg, shift, schoolId: targetSchool.id },
              });
              classGroupMap[key] = cg;
              classGroupMap[`${targetSchool.id}:${s.turma}`] = cg;
            }
          }
        }

        const templateMap = {};
        let templatesCount = 0;
        for (const seg of segments) {
          const templates = data[seg].templates || [];
          for (const t of templates) {
            const isAbsence = absenceKeywords.some((kw) => t.title.toUpperCase().includes(kw));
            const key = `${targetSchool.id}:${seg}:${t.title}`;
            if (!templateMap[key]) {
              const existing = await tx.messageTemplate.findFirst({
                where: { schoolId: targetSchool.id, title: t.title, segment: seg },
              });
              const tmpl =
                existing ||
                (await tx.messageTemplate.create({
                  data: {
                    schoolId: targetSchool.id,
                    title: t.title,
                    segment: seg,
                    prefixText: t.prefix || '',
                    suffixText: t.suffix || '',
                    isAbsenceRelated: isAbsence,
                  },
                }));
              if (!existing) templatesCount += 1;
              templateMap[key] = tmpl;
              templateMap[`${targetSchool.id}:${t.title}`] = tmpl;
            }
          }
        }

        const existingStudents = await tx.student.findMany({
          where: { schoolId: targetSchool.id },
        });
        const studentMap = {};
        const studentNameCounts = new Map();
        for (const s of existingStudents) {
          const k = `${targetSchool.id}:${s.name}`;
          studentMap[k] = s;
          studentNameCounts.set(k, (studentNameCounts.get(k) || 0) + 1);
        }

        let createdStudentsCount = 0;
        for (const seg of segments) {
          const students = data[seg].students || [];
          for (const s of students) {
            const studentKey = `${targetSchool.id}:${s.name}`;
            if (studentMap[studentKey]) continue;
            const cg =
              classGroupMap[`${targetSchool.id}:${seg}:${s.turma}`] ||
              classGroupMap[`${targetSchool.id}:${s.turma}`];
            if (!cg) continue;

            const created = await tx.student.create({
              data: {
                schoolId: targetSchool.id,
                name: s.name,
                guardianName: s.guardian || 'Responsável',
                phone: s.phone,
                classGroupId: cg.id,
              },
            });
            studentMap[studentKey] = created;
            studentNameCounts.set(studentKey, (studentNameCounts.get(studentKey) || 0) + 1);
            createdStudentsCount += 1;
          }
        }

        const logRecords = [];
        for (const seg of segments) {
          const logs = data[seg].logs || [];
          for (const l of logs) {
            const studentKey = `${targetSchool.id}:${l.student_name}`;
            const matchCount = studentNameCounts.get(studentKey) || 0;
            const student = studentMap[studentKey];

            if (replaceSchoolLogs) {
              if (matchCount > 1) {
                throw new Error(
                  `SEED_LOG_STUDENT_AMBIGUOUS: estudante ambíguo na escola (${l.student_name}).`
                );
              }
              if (!student) {
                throw new Error(
                  `SEED_LOG_STUDENT_NOT_FOUND: estudante não localizado para log de reposição (${l.student_name}).`
                );
              }
            } else if (!student || matchCount > 1) {
              continue;
            }

            const tmpl =
              templateMap[`${targetSchool.id}:${seg}:${l.reason}`] ||
              templateMap[`${targetSchool.id}:${l.reason}`];

            logRecords.push({
              schoolId: targetSchool.id,
              studentId: student.id,
              templateId: tmpl ? tmpl.id : null,
              reasonTitle: l.reason,
              messageContent: `Registro histórico importado de ${seg}: ${l.reason}`,
              phoneUsed: student.phone,
              sentByUserId: null,
              sentByName: l.pedagoga || 'Seed Institucional',
              guardianReplied: Boolean(l.returned),
              sentAt: new Date(l.date),
            });
          }
        }

        if (replaceSchoolLogs) {
          if (logRecords.length === 0) {
            throw new Error(
              'SEED_REPLACE_LOGS_EMPTY: --replace-school-logs exige pelo menos um log de reposição.'
            );
          }
          await tx.messageLog.deleteMany({ where: { schoolId: targetSchool.id } });
        }

        const chunkSize = 500;
        for (let i = 0; i < logRecords.length; i += chunkSize) {
          const chunk = logRecords.slice(i, i + chunkSize);
          await tx.messageLog.createMany({ data: chunk });
        }

        if (typeof options.onBeforeCommitForTest === 'function') {
          await options.onBeforeCommitForTest(tx);
        }

        return {
          schoolId: targetSchool.id,
          classGroupsCount: Object.keys(classGroupMap).length,
          templatesCount,
          studentsCount: createdStudentsCount,
          logsCount: logRecords.length,
        };
      },
      { maxWait: 10000, timeout: 60000 }
    );
  } finally {
    if (ownPrisma) {
      await prisma.$disconnect();
    }
  }
}

module.exports = { runSeed };

if (require.main === module) {
  runSeed()
    .then((summary) => {
      console.log('--- Seed concluído com escopo escolar ---', JSON.stringify(summary));
    })
    .catch((e) => {
      console.error(e?.message || e);
      process.exit(1);
    });
}
