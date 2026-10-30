const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", ".env");
let dbUrl = "";
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  envContent.split("\n").forEach((l) => {
    if (l.startsWith("DATABASE_URL")) {
      dbUrl = l.split("=").slice(1).join("=").trim().replace(/^"|"$/g, "");
    }
  });
}

if (!dbUrl) {
  console.error("DATABASE_URL não encontrada no .env");
  process.exit(1);
}

async function queryNeon(sql, params = []) {
  const res = await fetch("https://ep-delicate-leaf-b6hzdz3t.c-2.sa-east-1.aws.neon.tech/sql", {
    method: "POST",
    headers: {
      "Neon-Connection-String": dbUrl,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql, params }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Neon HTTP error (${res.status}): ${text}`);
  }
  return await res.json();
}

const CONSOLIDATION_MAP = [
  {
    oldEmail: "andreia@escola.pr.gov.br",
    newEmail: "andreia.carneiro@escola.pr.gov.br",
    description: "Andreia -> ANDREIA DE LOURDES BUENO CARNEIRO",
  },
  {
    oldEmail: "ana.cecilia@escola.pr.gov.br",
    newEmail: "ana.gamper@escola.pr.gov.br",
    description: "Ana Cecília -> ANA CECILIA GAMPER SINHORI",
  },
  {
    oldEmail: "natiele@escola.pr.gov.br",
    newEmail: "natiele.pacheco.santos@escola.pr.gov.br",
    description: "Natiele -> NATIELE PACHECO DOS SANTOS",
  },
  {
    oldEmail: "nathaly.r@escola.pr.gov.br",
    newEmail: "nathaly.ribeiro.rosa@escola.pr.gov.br",
    description: "Nathaly R. -> Nathaly Cristina Ribeiro da Rosa",
  },
];

async function main() {
  console.log("=== INICIANDO CONSOLIDAÇÃO DE SERVIDORES EM DUPLICIDADE ===\n");

  for (const pair of CONSOLIDATION_MAP) {
    console.log(`--- Consolidando: ${pair.description} ---`);

    const oldUserRes = await queryNeon(
      'SELECT id, name, email FROM "User" WHERE email = $1',
      [pair.oldEmail]
    );
    const newUserRes = await queryNeon(
      'SELECT id, name, email FROM "User" WHERE email = $1',
      [pair.newEmail]
    );

    if (oldUserRes.rows.length === 0) {
      console.log(`[Aviso] Usuário legado "${pair.oldEmail}" não existe mais. Pulando.`);
      continue;
    }

    if (newUserRes.rows.length === 0) {
      console.log(`[Erro] Novo usuário oficial "${pair.newEmail}" não encontrado no banco.`);
      continue;
    }

    const oldUser = oldUserRes.rows[0];
    const newUser = newUserRes.rows[0];

    console.log(`  De:   ${oldUser.name} (${oldUser.email}) [ID: ${oldUser.id}]`);
    console.log(`  Para: ${newUser.name} (${newUser.email}) [ID: ${newUser.id}]`);

    // 1. Migrar MessageLog onde foi quem enviou
    const updateSentRes = await queryNeon(
      'UPDATE "MessageLog" SET "sentByUserId" = $1, "sentByName" = $2 WHERE "sentByUserId" = $3 RETURNING id;',
      [newUser.id, newUser.name, oldUser.id]
    );
    const migratedSent = updateSentRes.rows.length;
    console.log(`  ✓ Mensagens enviadas migradas: ${migratedSent}`);

    // 2. Migrar MessageLog onde registrou retorno
    const updateRepliedRes = await queryNeon(
      'UPDATE "MessageLog" SET "repliedByUserId" = $1 WHERE "repliedByUserId" = $2 RETURNING id;',
      [newUser.id, oldUser.id]
    );
    const migratedReplied = updateRepliedRes.rows.length;
    console.log(`  ✓ Retornos registrados migrados: ${migratedReplied}`);

    // 3. Migrar AuditLog
    const updateAuditRes = await queryNeon(
      'UPDATE "AuditLog" SET "userId" = $1, "userEmail" = $2, "userName" = $3 WHERE "userId" = $4 RETURNING id;',
      [newUser.id, newUser.email, newUser.name, oldUser.id]
    );
    const migratedAudit = updateAuditRes.rows.length;
    console.log(`  ✓ Trilha de auditoria migrada: ${migratedAudit}`);

    // 4. Excluir o usuário legado
    await queryNeon('DELETE FROM "User" WHERE id = $1;', [oldUser.id]);
    console.log(`  ✓ Cadastro legado excluído com sucesso.\n`);
  }

  console.log("=== VERIFICAÇÃO FINAL DOS USUÁRIOS NO BANCO ===");
  const finalUsersRes = await queryNeon(`
    SELECT 
      u.id, 
      u.name, 
      u.email, 
      u.role, 
      u.active,
      COUNT(m.id) as total_messages
    FROM "User" u
    LEFT JOIN "MessageLog" m ON m."sentByUserId" = u.id
    GROUP BY u.id, u.name, u.email, u.role, u.active
    ORDER BY u.name ASC;
  `);
  console.table(finalUsersRes.rows);
  console.log("\nConsolidação concluída com 100% de integridade.");
}

main().catch((err) => {
  console.error("Erro fatal na consolidação:", err);
  process.exit(1);
});
