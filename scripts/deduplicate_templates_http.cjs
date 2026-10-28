const fs = require("fs");
const path = require("path");

const envContent = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
let dbUrl = "";
envContent.split("\n").forEach((l) => {
  if (l.startsWith("DATABASE_URL")) {
    dbUrl = l.split("=").slice(1).join("=").trim().replace(/^"|"$/g, "");
  }
});

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

async function main() {
  console.log("🚀 Iniciando Deduplicação e Consolidação de Modelos via Neon HTTP API...");

  const templatesRes = await queryNeon(
    'SELECT id, title, segment, "prefixText", "suffixText", "isAbsenceRelated" FROM "MessageTemplate" ORDER BY title ASC;'
  );
  const templates = templatesRes.rows;
  console.log(`Total de modelos atuais: ${templates.length}`);

  // Normalização do título para agrupamento
  const groups = {};
  for (const t of templates) {
    let key = t.title.trim().toUpperCase();
    if (key === "ATRASOS") key = "ATRASO";
    if (key === "NOTAS") key = "NOTAS";
    if (key === "UNIFORME") key = "UNIFORME";
    if (key === "COMPARECER A ESCOLA") key = "COMPARECER À ESCOLA";

    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  }

  let totalLogsRemapped = 0;
  let totalDupsDeleted = 0;

  for (const [key, list] of Object.entries(groups)) {
    // Escolhe o canônico (preferência FUNDAMENTAL)
    list.sort((a, b) => {
      if (a.segment === "FUNDAMENTAL") return -1;
      if (b.segment === "FUNDAMENTAL") return 1;
      if (a.segment === "MEDIO") return -1;
      if (b.segment === "MEDIO") return 1;
      return 0;
    });

    const canonical = list[0];
    const duplicates = list.slice(1);

    // Ajusta o prefixo para usar a tag {saudacao}
    let updatedPrefix = canonical.prefixText || "";
    if (/^(Boa tarde|Boa noite|Bom dia)!?/i.test(updatedPrefix)) {
      updatedPrefix = updatedPrefix.replace(/^(Boa tarde|Boa noite|Bom dia)!?/i, "{saudacao}");
    } else if (!updatedPrefix.startsWith("{saudacao}")) {
      updatedPrefix = `{saudacao}\n${updatedPrefix}`.trim();
    }

    // Atualiza canônico
    await queryNeon(
      'UPDATE "MessageTemplate" SET segment = $1, "prefixText" = $2, title = $3 WHERE id = $4;',
      ["TODOS", updatedPrefix, key, canonical.id]
    );
    console.log(`\n✅ Canônico consolidado: [${key}] (ID: ${canonical.id})`);

    // Trata duplicatas
    for (const dup of duplicates) {
      // Remapear MessageLog
      const logUpdate = await queryNeon(
        'UPDATE "MessageLog" SET "templateId" = $1 WHERE "templateId" = $2;',
        [canonical.id, dup.id]
      );
      const remappedCount = logUpdate.rowCount || 0;
      totalLogsRemapped += remappedCount;

      // Excluir duplicata
      await queryNeon('DELETE FROM "MessageTemplate" WHERE id = $1;', [dup.id]);
      totalDupsDeleted++;
      console.log(`   🗑️ Remapeados ${remappedCount} logs e excluída duplicata ${dup.segment} [${dup.id}]`);
    }
  }

  // Registrar na trilha de auditoria
  await queryNeon(
    `INSERT INTO "AuditLog" ("id", "userName", "userEmail", "action", "entityType", "details", "createdAt")
     VALUES ($1, $2, $3, $4, $5, $6, NOW());`,
    [
      `audit_${Date.now()}`,
      "Administrador",
      "marcos.wrobel@escola.pr.gov.br",
      "DEDUPLICATE_TEMPLATES",
      "MessageTemplate",
      JSON.stringify({
        description: "Unificação dos 23 modelos legados de Fundamental, Médio e Noturno para modelos com interpolação dinâmica por período",
        modelsDeleted: totalDupsDeleted,
        logsRemapped: totalLogsRemapped,
      }),
    ]
  );

  const finalRes = await queryNeon(
    'SELECT id, title, segment, "prefixText" FROM "MessageTemplate" ORDER BY title ASC;'
  );
  console.log(`\n🎉 Deduplicação concluída!`);
  console.log(`Modelos antes: ${templates.length} -> Modelos agora: ${finalRes.rows.length}`);
  console.log(`Total de logs remapeados com segurança: ${totalLogsRemapped}`);
  console.log(`Total de duplicatas eliminadas: ${totalDupsDeleted}\n`);
  finalRes.rows.forEach((r) => {
    console.log(`- [${r.segment}] ${r.title} | Prefixo: "${r.prefixText.replace(/\n/g, " ")}"`);
  });
}

main().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});
