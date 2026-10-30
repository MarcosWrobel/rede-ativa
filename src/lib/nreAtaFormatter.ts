/**
 * Regras e gerador local de Minuta de Ata Pedagógica
 * em conformidade com as Diretrizes Oficiais do NRE/SEED-PR
 * e rigor gramatical (pretérito perfeito, texto corrido, numerais por extenso e ciência).
 */

export function sanitizeAndCorrectPedagogicalNotes(text: string): string {
  if (!text) return "";
  let clean = text
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ");

  // Correções básicas ortográficas e de norma culta
  const typoRules: [RegExp, string][] = [
    [/\bconflita\b/gi, "conflito"],
    [/\bconflitas\b/gi, "conflitos"],
    [/\bpor conta de\b/gi, "em virtude de"],
    [/\bpor causa de\b/gi, "em virtude de"],
    [/\bpra\b/gi, "para"],
    [/\bpro\b/gi, "para o"],
    [/\bpras\b/gi, "para as"],
    [/\bpros\b/gi, "para os"],
    [/\bvc\b/gi, "você"],
    [/\bvcs\b/gi, "vocês"],
    [/\btbm\b/gi, "também"],
    [/\bpq\b/gi, "porque"],
    [/\bta\b/gi, "está"],
    [/\btava\b/gi, "estava"],
    [/\bprof\b/gi, "Professor(a)"],
    [/\bprofa\b/gi, "Professora"],
    [/\bcoord\b/gi, "Coordenação Pedagógica"],
  ];

  for (const [regex, replacement] of typoRules) {
    clean = clean.replace(regex, replacement);
  }

  // Capitaliza a primeira letra e garante pontuação final
  clean = clean.trim();
  if (clean.length > 0) {
    clean = clean.charAt(0).toUpperCase() + clean.slice(1);
    if (!/[.!?]$/.test(clean)) {
      clean += ".";
    }
  }

  return clean;
}

export function generateLocalAtaMinuta({
  rawNotes,
  existingSummary,
  category,
  studentNames,
  guardianNames,
}: {
  rawNotes: string;
  existingSummary?: string;
  category: string;
  studentNames: string[];
  guardianNames: string[];
}) {
  const studentsStr = studentNames.length > 0 ? studentNames.join(" e ") : "o(a) estudante";
  const guardiansStr = guardianNames.length > 0 ? guardianNames.join(", ") : "o(a) responsável legal";

  // Se já havia um texto prévio, limpa quebras e reaproveita aplicando sanitização
  if (existingSummary && existingSummary.trim().length >= 10) {
    const cleanExisting = sanitizeAndCorrectPedagogicalNotes(existingSummary);

    // Adiciona cláusula de encerramento do NRE se não contiver
    const hasClosing =
      cleanExisting.toLowerCase().includes("lida") &&
      cleanExisting.toLowerCase().includes("achada conforme");

    const finalSummary = hasClosing
      ? cleanExisting
      : `${cleanExisting.replace(/\.?$/, ".")} Nada mais havendo a constar, a presente ata foi lida e conferida por todos os presentes, que apuseram sua ciência e assinatura.`;

    return {
      formalSubject: `Atendimento Pedagógico — ${category.replace(/_/g, " ")}`,
      formalSummary: finalSummary,
      agreementsSummary:
        "A família e a escola acordaram acompanhar conjuntamente a assiduidade e o cumprimento das recomendações escolares.",
      actionItems: [
        {
          description: "Acompanhar cumprimento dos combinados e rotina escolar",
          responsible: "FAMILIA",
          suggestedDaysToComplete: 7,
        },
      ],
    };
  }

  const cleanNotes = sanitizeAndCorrectPedagogicalNotes(rawNotes || "");

  const formalSummary = `Aos dias correntes, nas dependências da Equipe Pedagógica deste estabelecimento de ensino, realizou-se atendimento com a presença de ${guardiansStr}, referente a(o) ${studentsStr}, para tratar de assuntos pertinentes a(o) ${category.toLowerCase().replace(/_/g, " ")}. Pela equipe pedagógica foram pontuados os seguintes aspectos: ${cleanNotes} O(A) responsável tomou ciência das orientações escolares, apresentou seus esclarecimentos e comprometeu-se a acompanhar a rotina e as recomendações pedagógicas estabelecidas nesta data. Nada mais havendo a constar, a presente ata foi lida e conferida por todos os presentes, que apuseram sua ciência e assinatura.`;

  return {
    formalSubject: `Atendimento Pedagógico — ${category.replace(/_/g, " ")}`,
    formalSummary,
    agreementsSummary:
      "A família e a escola acordaram acompanhar conjuntamente a assiduidade e o cumprimento das recomendações escolares.",
    actionItems: [
      {
        description: "Acompanhar cumprimento dos combinados e rotina escolar",
        responsible: "FAMILIA",
        suggestedDaysToComplete: 7,
      },
    ],
  };
}
