/**
 * Regras e gerador local de Minuta de Ata Pedagógica
 * em conformidade com as Diretrizes Oficiais do NRE/SEED-PR
 * e rigor gramatical (pretérito perfeito, texto corrido, numerais por extenso e ciência).
 */

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

  // Se já havia um texto prévio, limpa quebras e reaproveita
  if (existingSummary && existingSummary.trim().length >= 10) {
    const cleanExisting = existingSummary
      .replace(/\r\n/g, "\n")
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" ");

    // Adiciona cláusula de encerramento do NRE se não contiver
    const hasClosing =
      cleanExisting.toLowerCase().includes("lida") &&
      cleanExisting.toLowerCase().includes("achada conforme");

    const finalSummary = hasClosing
      ? cleanExisting
      : `${cleanExisting} Nada mais havendo a constar, a presente ata foi lida e conferida por todos os presentes, que apuseram sua ciência e assinatura.`;

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

  const lines = (rawNotes || "")
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const cleanNotes = lines.join(" ");

  const formalSummary = `Aos dias correntes, nas dependências da Equipe Pedagógica deste estabelecimento de ensino, realizou-se atendimento com a presença de ${guardiansStr}, referente a(o) ${studentsStr}, para tratar de assuntos pertinentes a(o) ${category.toLowerCase().replace(/_/g, " ")}. Pela equipe pedagógica foram pontuados os seguintes aspectos: ${cleanNotes}. O(A) responsável tomou ciência das orientações escolares, apresentou seus esclarecimentos e comprometeu-se a acompanhar a rotina e as recomendações pedagógicas estabelecidas nesta data. Nada mais havendo a constar, a presente ata foi lida e conferida por todos os presentes, que apuseram sua ciência e assinatura.`;

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
