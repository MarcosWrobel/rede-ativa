/**
 * Regras e gerador local de Minuta de Ata Pedagógica
 * em conformidade com as Diretrizes Oficiais do NRE/SEED-PR
 * e rigor gramatical (pretérito perfeito, texto corrido, numerais por extenso e ciência).
 */

const DIAS_EXTENSO = [
  "", "primeiro", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez",
  "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove", "vinte",
  "vinte e um", "vinte e dois", "vinte e três", "vinte e quatro", "vinte e cinco", "vinte e seis",
  "vinte e sete", "vinte e oito", "vinte e nove", "trinta", "trinta e um"
];

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
];

function convertYearToExtenso(year: number): string {
  const yearsMap: Record<number, string> = {
    2024: "dois mil e vinte e quatro",
    2025: "dois mil e vinte e cinco",
    2026: "dois mil e vinte e seis",
    2027: "dois mil e vinte e sete",
    2028: "dois mil e vinte e oito",
    2029: "dois mil e vinte e nove",
    2030: "dois mil e trinta",
  };
  return yearsMap[year] || String(year);
}

export function formatAtaDateExtenso(dateInput?: string | Date | null): {
  diaExtenso: string;
  mesExtenso: string;
  anoExtenso: string;
  dataExtensoCompleta: string;
  horaFormatada: string;
} {
  let d: Date;
  if (!dateInput) {
    d = new Date();
  } else if (typeof dateInput === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    d = new Date(`${dateInput}T12:00:00.000-03:00`);
  } else {
    d = new Date(dateInput);
  }
  const validDate = isNaN(d.getTime()) ? new Date() : d;

  // Extrai componentes estritamente no fuso horário oficial do Paraná (America/Sao_Paulo - UTC-3)
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });

  const parts = dtf.formatToParts(validDate);
  const partMap: Record<string, string> = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }

  const day = parseInt(partMap.day || "1", 10);
  const monthIdx = parseInt(partMap.month || "10", 10) - 1;
  const year = parseInt(partMap.year || "2026", 10);
  const hours = parseInt(partMap.hour || "0", 10);
  const minutes = parseInt(partMap.minute || "0", 10);

  const diaExtenso = DIAS_EXTENSO[day] || String(day);
  const mesExtenso = MESES[monthIdx] || "outubro";
  const anoExtenso = convertYearToExtenso(year);

  const horaFormatada = `${String(hours).padStart(2, "0")}h${String(minutes).padStart(2, "0")}`;

  const dataExtensoCompleta =
    day === 1
      ? `Ao primeiro dia do mês de ${mesExtenso} do ano de ${anoExtenso}`
      : `Aos ${diaExtenso} dias do mês de ${mesExtenso} do ano de ${anoExtenso}`;

  return {
    diaExtenso,
    mesExtenso,
    anoExtenso,
    dataExtensoCompleta,
    horaFormatada,
  };
}

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
  attendedAt,
}: {
  rawNotes: string;
  existingSummary?: string;
  category: string;
  studentNames: string[];
  guardianNames: string[];
  attendedAt?: string | Date;
}) {
  const studentsStr = studentNames.length > 0 ? studentNames.join(" e ") : "o(a) estudante";
  const guardiansStr = guardianNames.length > 0 ? guardianNames.join(", ") : "o(a) responsável legal";
  const dateInfo = formatAtaDateExtenso(attendedAt);

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

  const formalSummary = `${dateInfo.dataExtensoCompleta}, nas dependências da Equipe Pedagógica deste estabelecimento de ensino, realizou-se atendimento com a presença de ${guardiansStr}, referente a(o) ${studentsStr}, para tratar de assuntos pertinentes a(o) ${category.toLowerCase().replace(/_/g, " ")}. Pela equipe pedagógica foram pontuados os seguintes aspectos: ${cleanNotes} O(A) responsável tomou ciência das orientações escolares, apresentou seus esclarecimentos e comprometeu-se a acompanhar a rotina e as recomendações pedagógicas estabelecidas nesta data. Nada mais havendo a constar, a presente ata foi lida e conferida por todos os presentes, que apuseram sua ciência e assinatura.`;

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
