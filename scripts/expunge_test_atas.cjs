const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
  console.log('=== Iniciando Expurgo Técnico de Atas de Teste/Homologação ===');

  // 1. Busca todas as atas existentes atualmente com suas dependências completas
  const minutes = await prisma.pedagogicalMinute.findMany({
    include: {
      school: {
        select: { id: true, inepCode: true, name: true },
      },
      students: true,
      participants: true,
      addendums: true,
      actionItems: true,
    },
  });

  console.log(`Total de atas encontradas para expurgo: ${minutes.length}`);

  if (minutes.length === 0) {
    console.log('Nenhuma ata pendente para expurgo. O banco já está limpo.');
    return;
  }

  // 2. Criação do backup de segurança estruturado antes de qualquer exclusão
  const backupDir = path.join(__dirname, '..', 'storage', 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `atas_test_backup_${timestamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(minutes, null, 2), 'utf-8');
  console.log(`✓ Backup de segurança salvo em: ${backupPath}`);

  // 3. Expurgo em transação atômica
  const deletedIds = minutes.map((m) => m.id);
  const result = await prisma.$transaction(async (tx) => {
    // Como PedagogicalMinuteStudent, PedagogicalMinuteParticipant, PedagogicalMinuteAddendum e PedagogicalActionItem
    // possuem onDelete: Cascade, o deleteMany em PedagogicalMinute remove atomicamente todas as dependências.
    const del = await tx.pedagogicalMinute.deleteMany({
      where: {
        id: { in: deletedIds },
      },
    });

    // Grava log formal de auditoria para cada escola afetada
    for (const m of minutes) {
      await tx.auditLog.create({
        data: {
          schoolId: m.schoolId,
          action: 'ADMIN_EXPUNGE_TEST_ATA',
          entityType: 'PedagogicalMinute',
          entityId: m.id,
          details: `Expurgo técnico de ata de teste/homologação (Ata ${m.ataNumber ? `nº ${String(m.ataNumber).padStart(3, '0')}/${m.year}` : 'Rascunho'} - "${m.subject}"). Livro oficial do ano ${m.year} zerado para início de produção.`,
          userEmail: 'admin@sistema',
          userName: 'Administrador Geral (Expurgo Técnico)',
        },
      });
    }

    return del;
  });

  console.log(`✓ ${result.count} ata(s) de teste expurgada(s) com sucesso.`);

  // 4. Verificação de Integridade Pós-Expurgo
  const remaining = await prisma.pedagogicalMinute.count();
  console.log(`Total de atas restantes no sistema: ${remaining}`);

  console.log('✓ Livro oficial pronto para produção: a próxima ata lavrada será a Ata nº 001/2026.');
}

main()
  .catch((err) => {
    console.error('Erro ao expurgar atas de teste:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
