const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

function resolveCliArg(prefix) {
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : '';
}

/**
 * Executa o seed com escopo escolar estrito e `withTenantContext` (`set_config`)
 * para compatibilidade com a Fase B da Onda 1 sob `FORCE ROW LEVEL SECURITY`.
 * Exige escola explícita (`schoolId` ou `inepCode`) e nunca executa exclusões globais.
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
        'SEED_EXPLICIT_SCHOOL_REQUIRED: informe schoolId ou inepCode explícito (SEED_SCHOOL_ID / SEED_SCHOOL_INEP) antes de executar o seed.'
      );
    }

    const bootstrapPilot =
      options.bootstrapPilotIfMissing === true || process.env.SEED_BOOTSTRAP_PILOT === 'true';

    let targetSchool = null;
    if (schoolId) {
      targetSchool = await prisma.school.findUnique({ where: { id: schoolId } });
    } else if (inepCode) {
      targetSchool = await prisma.school.findUnique({ where: { inepCode } });
    }

    if (!targetSchool && bootstrapPilot && inepCode === '41042730') {
      targetSchool = await prisma.school.upsert({
        where: { inepCode: '41042730' },
        update: {},
        create: {
          inepCode: '41042730',
          name: 'Colégio Estadual Leopoldina B. Pedroso',
          city: 'Ponta Grossa',
          state: 'PR',
          nre: 'Ponta Grossa',
          active: true,
          logoUrl: '/logo.svg',
        },
      });
    }

    if (!targetSchool || targetSchool.active === false) {
      throw new Error(
        `SEED_SCHOOL_NOT_FOUND_OR_INACTIVE: escola alvo não encontrada ou inativa (${schoolId || inepCode}).`
      );
    }

    const privRows = await prisma.$queryRaw`
      SELECT
        has_table_privilege(current_user, 'public."User"', 'INSERT, UPDATE') AS can_write_user,
        has_table_privilege(current_user, 'public."LowAttendanceRecord"', 'INSERT, UPDATE') AS can_write_low_att,
        has_table_privilege(current_user, 'public."AuditLog"', 'INSERT') AS can_write_audit
    `;
    const privs = privRows[0] || {};

    const userMap = {};
    if (privs.can_write_user) {
      const usersToCreate = [
        { name: 'MARCOS ADRIANO WROBEL', email: 'marcos.wrobel@escola.pr.gov.br', role: 'ADMIN', schoolId: targetSchool.id },
        { name: 'ADRIANA DE ALMEIDA BUENO', email: 'bueno.adriana@escola.pr.gov.br', role: 'ADMIN', schoolId: targetSchool.id },
        { name: 'ANDREIA DE LOURDES BUENO CARNEIRO', email: 'andreia.carneiro@escola.pr.gov.br', role: 'PEDAGOGA', schoolId: targetSchool.id },
        { name: 'ANA CECILIA GAMPER SINHORI', email: 'ana.gamper@escola.pr.gov.br', role: 'PEDAGOGA', schoolId: targetSchool.id },
        { name: 'Jaqueline Lopes', email: 'jaqueline.lopes@escola.pr.gov.br', role: 'PEDAGOGA', schoolId: targetSchool.id },
        { name: 'Nathaly Cristina Ribeiro da Rosa', email: 'nathaly.ribeiro.rosa@escola.pr.gov.br', role: 'PEDAGOGA', schoolId: targetSchool.id },
        { name: 'NATIELE PACHECO DOS SANTOS', email: 'natiele.pacheco.santos@escola.pr.gov.br', role: 'PEDAGOGA', schoolId: targetSchool.id },
      ];

      for (const u of usersToCreate) {
        const user = await prisma.user.upsert({
          where: { email: u.email },
          update: { name: u.name, role: u.role },
          create: u,
        });
        userMap[u.name.toLowerCase()] = user;
        userMap[u.email] = user;
      }

      userMap['andreia'] = userMap['andreia.carneiro@escola.pr.gov.br'];
      userMap['ana cecília'] = userMap['ana.gamper@escola.pr.gov.br'];
      userMap['ana cecilia'] = userMap['ana.gamper@escola.pr.gov.br'];
      userMap['nathaly r.'] = userMap['nathaly.ribeiro.rosa@escola.pr.gov.br'];
      userMap['nathaly'] = userMap['nathaly.ribeiro.rosa@escola.pr.gov.br'];
      userMap['natiele'] = userMap['natiele.pacheco.santos@escola.pr.gov.br'];
    }

    const dataPath = options.dataPath || path.join(__dirname, 'extracted_data.json');
    if (!fs.existsSync(dataPath)) {
      return {
        schoolId: targetSchool.id,
        earlyExit: true,
        classGroupsCount: 0,
        templatesCount: 0,
        studentsCount: 0,
        logsCount: 0,
        lowAttendanceCount: 0,
      };
    }

    const rawData = fs.readFileSync(dataPath, 'utf-8');
    const data = JSON.parse(rawData);

    function getUserId(pedagogaName) {
      if (!pedagogaName || Object.keys(userMap).length === 0) return null;
      const lower = pedagogaName.toLowerCase();
      for (const key of Object.keys(userMap)) {
        if (lower.includes(key) || key.includes(lower)) {
          return userMap[key].id;
        }
      }
      return userMap['marcos.wrobel@escola.pr.gov.br']?.id || null;
    }

    const replaceSchoolLogs =
      options.replaceSchoolLogs === true || process.env.SEED_REPLACE_SCHOOL_LOGS === 'true';

    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_school_id', ${targetSchool.id}, true)`;

        const segments = ['FUNDAMENTAL', 'MEDIO', 'NOTURNO'].filter((seg) => Boolean(data[seg]));
        const classGroupMap = {};
        const absenceKeywords = ['FALTOU', 'FALTAS', 'GAZEOU', 'ATRASO', 'ATRASOS'];

        for (const seg of segments) {
          const students = data[seg].students || [];
          const shift = seg === 'NOTURNO' ? 'NOITE' : seg === 'MEDIO' ? 'MANHA' : 'TARDE';

          for (const s of students) {
            if (!s.turma) continue;
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
                    prefixText: t.prefix,
                    suffixText: t.suffix,
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
        for (const s of existingStudents) {
          studentMap[`${targetSchool.id}:${s.name}`] = s;
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
            createdStudentsCount += 1;
          }
        }

        if (replaceSchoolLogs) {
          await tx.messageLog.deleteMany({ where: { schoolId: targetSchool.id } });
        }

        const logRecords = [];
        for (const seg of segments) {
          const logs = data[seg].logs || [];
          for (const l of logs) {
            const student = studentMap[`${targetSchool.id}:${l.student_name}`];
            if (!student) continue;

            const userId = getUserId(l.pedagoga);
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
              sentByUserId: userId,
              sentByName: l.pedagoga,
              guardianReplied: Boolean(l.returned),
              sentAt: new Date(l.date),
            });
          }
        }

        const chunkSize = 500;
        for (let i = 0; i < logRecords.length; i += chunkSize) {
          const chunk = logRecords.slice(i, i + chunkSize);
          await tx.messageLog.createMany({ data: chunk });
        }

        let lowAttCount = 0;
        if (privs.can_write_low_att) {
          for (const seg of segments) {
            const records = data[seg].low_attendance || [];
            for (const r of records) {
              const student = studentMap[`${targetSchool.id}:${r.student_name}`];
              if (!student) continue;

              await tx.lowAttendanceRecord.upsert({
                where: { studentId: student.id },
                update: {
                  attendancePercent: r.attendance_percent,
                  enrollmentDetail: r.enrollment_detail,
                  actionsTaken: r.actions_taken,
                },
                create: {
                  studentId: student.id,
                  attendancePercent: r.attendance_percent,
                  enrollmentDetail: r.enrollment_detail,
                  actionsTaken: r.actions_taken,
                },
              });
              lowAttCount += 1;
            }
          }
        }

        if (privs.can_write_audit && userMap['marcos.wrobel@escola.pr.gov.br']) {
          const admin = userMap['marcos.wrobel@escola.pr.gov.br'];
          await tx.auditLog.create({
            data: {
              schoolId: targetSchool.id,
              userId: admin.id,
              userEmail: admin.email,
              userName: admin.name,
              action: 'INITIAL_DATABASE_MIGRATION',
              entityType: 'System',
              details: JSON.stringify({
                schoolId: targetSchool.id,
                studentsImported: createdStudentsCount,
                logsImported: logRecords.length,
                lowAttendanceImported: lowAttCount,
              }),
            },
          });
        }

        return {
          schoolId: targetSchool.id,
          earlyExit: false,
          classGroupsCount: Object.keys(classGroupMap).length,
          templatesCount,
          studentsCount: createdStudentsCount,
          logsCount: logRecords.length,
          lowAttendanceCount: lowAttCount,
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
      console.error(e);
      process.exit(1);
    });
}
