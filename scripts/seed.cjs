const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
  console.log('--- Starting Database Seeding (Optimized Batch Mode) ---');

  const rawData = fs.readFileSync(path.join(__dirname, 'extracted_data.json'), 'utf-8');
  const data = JSON.parse(rawData);

  // 0. Seed Default School
  const defaultSchool = await prisma.school.upsert({
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
  console.log('Seeded default school:', defaultSchool.name);

  // 1. Seed Users (Oficiais @escola.pr.gov.br)
  const usersToCreate = [
    { name: 'MARCOS ADRIANO WROBEL', email: 'marcos.wrobel@escola.pr.gov.br', role: 'ADMIN', schoolId: defaultSchool.id },
    { name: 'ADRIANA DE ALMEIDA BUENO', email: 'bueno.adriana@escola.pr.gov.br', role: 'ADMIN', schoolId: defaultSchool.id },
    { name: 'ANDREIA DE LOURDES BUENO CARNEIRO', email: 'andreia.carneiro@escola.pr.gov.br', role: 'PEDAGOGA', schoolId: defaultSchool.id },
    { name: 'ANA CECILIA GAMPER SINHORI', email: 'ana.gamper@escola.pr.gov.br', role: 'PEDAGOGA', schoolId: defaultSchool.id },
    { name: 'Jaqueline Lopes', email: 'jaqueline.lopes@escola.pr.gov.br', role: 'PEDAGOGA', schoolId: defaultSchool.id },
    { name: 'Nathaly Cristina Ribeiro da Rosa', email: 'nathaly.ribeiro.rosa@escola.pr.gov.br', role: 'PEDAGOGA', schoolId: defaultSchool.id },
    { name: 'NATIELE PACHECO DOS SANTOS', email: 'natiele.pacheco.santos@escola.pr.gov.br', role: 'PEDAGOGA', schoolId: defaultSchool.id },
  ];

  const userMap = {};
  for (const u of usersToCreate) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role },
      create: u,
    });
    userMap[u.name.toLowerCase()] = user;
    userMap[u.email] = user;
  }

  // Aliases para nomes simplificados legados da planilha
  userMap['andreia'] = userMap['andreia.carneiro@escola.pr.gov.br'];
  userMap['ana cecília'] = userMap['ana.gamper@escola.pr.gov.br'];
  userMap['ana cecilia'] = userMap['ana.gamper@escola.pr.gov.br'];
  userMap['nathaly r.'] = userMap['nathaly.ribeiro.rosa@escola.pr.gov.br'];
  userMap['nathaly'] = userMap['nathaly.ribeiro.rosa@escola.pr.gov.br'];
  userMap['natiele'] = userMap['natiele.pacheco.santos@escola.pr.gov.br'];
  console.log('Seeded official users.');

  function getUserId(pedagogaName) {
    if (!pedagogaName) return null;
    const lower = pedagogaName.toLowerCase();
    for (const key of Object.keys(userMap)) {
      if (lower.includes(key) || key.includes(lower)) {
        return userMap[key].id;
      }
    }
    return userMap['marcos.wrobel@escola.pr.gov.br'].id;
  }

  // 2. ClassGroups
  const segments = ['FUNDAMENTAL', 'MEDIO', 'NOTURNO'];
  const classGroupMap = {};

  for (const seg of segments) {
    const students = data[seg].students;
    const shift = seg === 'NOTURNO' ? 'NOITE' : (seg === 'MEDIO' ? 'MANHA' : 'TARDE');

    for (const s of students) {
      if (!s.turma) continue;
      const key = `${seg}_${s.turma}`;
      if (!classGroupMap[key]) {
        const cg = await prisma.classGroup.upsert({
          where: { name: s.turma },
          update: { segment: seg, shift },
          create: { name: s.turma, segment: seg, shift },
        });
        classGroupMap[key] = cg;
        classGroupMap[s.turma] = cg;
      }
    }
  }
  console.log(`Seeded class groups.`);

  // 3. MessageTemplates
  const templateMap = {};
  const absenceKeywords = ['FALTOU', 'FALTAS', 'GAZEOU', 'ATRASO', 'ATRASOS'];

  for (const seg of segments) {
    const templates = data[seg].templates;
    for (const t of templates) {
      const isAbsence = absenceKeywords.some(kw => t.title.toUpperCase().includes(kw));
      const key = `${seg}_${t.title}`;
      if (!templateMap[key]) {
        const existing = await prisma.messageTemplate.findFirst({
          where: { title: t.title, segment: seg }
        });
        const tmpl = existing || await prisma.messageTemplate.create({
          data: {
            title: t.title,
            segment: seg,
            prefixText: t.prefix,
            suffixText: t.suffix,
            isAbsenceRelated: isAbsence,
          },
        });
        templateMap[key] = tmpl;
        templateMap[t.title] = tmpl;
      }
    }
  }
  console.log('Seeded templates.');

  // 4. Students
  // Load all existing students from DB
  const existingStudents = await prisma.student.findMany();
  const studentMap = {};
  for (const s of existingStudents) {
    studentMap[s.name] = s;
  }

  for (const seg of segments) {
    const students = data[seg].students;
    for (const s of students) {
      if (studentMap[s.name]) continue;
      const cg = classGroupMap[`${seg}_${s.turma}`] || classGroupMap[s.turma];
      if (!cg) continue;

      const created = await prisma.student.create({
        data: {
          name: s.name,
          guardianName: s.guardian || 'Responsável',
          phone: s.phone,
          classGroupId: cg.id,
        },
      });
      studentMap[s.name] = created;
    }
  }
  console.log(`Students verified/seeded.`);

  // 5. Message Logs - Batch Insert
  // Clear any partial logs
  await prisma.messageLog.deleteMany({});
  console.log('Cleared existing logs for clean batch insert.');

  const logRecords = [];
  for (const seg of segments) {
    const logs = data[seg].logs;
    for (const l of logs) {
      const student = studentMap[l.student_name];
      if (!student) continue;

      const userId = getUserId(l.pedagoga);
      const tmpl = templateMap[`${seg}_${l.reason}`] || templateMap[l.reason];

      logRecords.push({
        studentId: student.id,
        templateId: tmpl ? tmpl.id : null,
        reasonTitle: l.reason,
        messageContent: `Registro histórico importado de ${seg}: ${l.reason}`,
        phoneUsed: student.phone,
        sentByUserId: userId,
        sentByName: l.pedagoga,
        guardianReplied: l.returned,
        sentAt: new Date(l.date),
      });
    }
  }

  // Insert in chunks of 500
  const chunkSize = 500;
  for (let i = 0; i < logRecords.length; i += chunkSize) {
    const chunk = logRecords.slice(i, i + chunkSize);
    await prisma.messageLog.createMany({ data: chunk });
    console.log(`Inserted ${Math.min(i + chunkSize, logRecords.length)} / ${logRecords.length} logs.`);
  }

  // 6. Low Attendance Records
  let lowAttCount = 0;
  for (const seg of segments) {
    const records = data[seg].low_attendance || [];
    for (const r of records) {
      const student = studentMap[r.student_name];
      if (!student) continue;

      await prisma.lowAttendanceRecord.upsert({
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
      lowAttCount++;
    }
  }
  console.log(`Seeded ${lowAttCount} low attendance records.`);

  // 7. Initial Audit Log
  const admin = userMap['marcos.wrobel@escola.pr.gov.br'];
  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      userEmail: admin.email,
      userName: admin.name,
      action: 'INITIAL_DATABASE_MIGRATION',
      entityType: 'System',
      details: JSON.stringify({
        description: 'Migração completa para Neon PostgreSQL - Colégio Leopoldina 2026',
        studentsImported: Object.keys(studentMap).length,
        logsImported: logRecords.length,
        lowAttendanceImported: lowAttCount,
      }),
    },
  });

  console.log('--- Neon Database Seeding Finished Successfully! ---');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
