const fs = require("fs");
const path = require("path");

// Load .env
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  envContent.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const idx = trimmed.indexOf("=");
    if (idx !== -1) {
      const key = trimmed.substring(0, idx).trim();
      let val = trimmed.substring(idx + 1).trim();
      val = val.replace(/^["']|["']$/g, "");
      process.env[key] = val;
    }
  });
}

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log("🔍 Consultando modelos existentes no banco...");
  const templates = await prisma.messageTemplate.findMany({
    orderBy: { title: "asc" },
  });

  console.log(`Total de modelos encontrados: ${templates.length}\n`);

  // Agrupar por título normalizado
  const groups = {};
  for (const t of templates) {
    const key = t.title.trim().toUpperCase().replace(/S$/, ""); // e.g. ATRASOS -> ATRASO
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  }

  console.log("Agrupamento de títulos:");
  for (const [key, list] of Object.entries(groups)) {
    console.log(`- ${key}: ${list.length} ocorrência(s) [${list.map((x) => x.segment).join(", ")}]`);
  }

  let totalMerged = 0;
  let totalDeleted = 0;

  for (const [key, list] of Object.entries(groups)) {
    if (list.length <= 1) {
      // Já é único, apenas garantir segment = "TODOS" se aplicável
      const single = list[0];
      if (single.segment !== "TODOS") {
        await prisma.messageTemplate.update({
          where: { id: single.id },
          data: { segment: "TODOS" },
        });
        console.log(`✅ Modelo único ${single.title} atualizado para segment: TODOS`);
      }
      continue;
    }

    // Múltiplas ocorrências: escolher o canônico (preferir FUNDAMENTAL ou o mais completo)
    // Ordenar para dar preferência a FUNDAMENTAL, depois MEDIO, depois NOTURNO
    list.sort((a, b) => {
      if (a.segment === "FUNDAMENTAL") return -1;
      if (b.segment === "FUNDAMENTAL") return 1;
      if (a.segment === "MEDIO") return -1;
      if (b.segment === "MEDIO") return 1;
      return 0;
    });

    const canonical = list[0];
    const duplicates = list.slice(1);

    console.log(`\n📌 Consolidando ${key}:`);
    console.log(`   Canônico: [${canonical.id}] (${canonical.segment}) "${canonical.title}"`);

    // Atualizar o canônico para "TODOS" e modernizar saudação com {saudacao}
    let updatedPrefix = canonical.prefixText;
    // Se o prefixo começava com saudação fixa, normalizar para {saudacao}
    if (/^(Boa tarde|Boa noite|Bom dia)!?/i.test(updatedPrefix)) {
      updatedPrefix = updatedPrefix.replace(/^(Boa tarde|Boa noite|Bom dia)!?/i, "{saudacao}");
    }

    await prisma.messageTemplate.update({
      where: { id: canonical.id },
      data: {
        segment: "TODOS",
        prefixText: updatedPrefix,
        active: true,
      },
    });

    // Remapear MessageLogs apontando para as duplicatas
    for (const dup of duplicates) {
      const logsUpdated = await prisma.messageLog.updateMany({
        where: { templateId: dup.id },
        data: { templateId: canonical.id },
      });

      console.log(`   -> Remapeados ${logsUpdated.count} logs de [${dup.id}] (${dup.segment}) para o canônico`);
      totalMerged += logsUpdated.count;

      // Excluir a duplicata
      await prisma.messageTemplate.delete({
        where: { id: dup.id },
      });
      totalDeleted++;
      console.log(`   🗑️ Duplicata [${dup.id}] excluída com sucesso`);
    }
  }

  const remaining = await prisma.messageTemplate.findMany();
  console.log(`\n🎉 Concluído! Modelos consolidados de ${templates.length} para ${remaining.length}.`);
  console.log(`Total de logs remapeados: ${totalMerged}, duplicatas removidas: ${totalDeleted}`);

  process.exit(0);
}

main().catch((e) => {
  console.error("Erro na deduplicação:", e);
  process.exit(1);
});
