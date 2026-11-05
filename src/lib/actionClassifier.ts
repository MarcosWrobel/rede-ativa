/**
 * Classificador temático inteligente de compromissos e encaminhamentos pactuados em ata (JUR-03).
 */
export type ActionItemCategoryType =
  | "LAUDO_MEDICO"
  | "RETORNO_FAMILIAR"
  | "REDE_PROTECAO"
  | "PEDAGOGICO"
  | "GERAL";

export function classifyActionItemCategory(description: string): {
  category: ActionItemCategoryType;
  label: string;
} {
  const desc = (description || "").toLowerCase();
  if (
    desc.includes("laudo") ||
    desc.includes("atestado") ||
    desc.includes("médic") ||
    desc.includes("neurolog") ||
    desc.includes("psiquiat") ||
    desc.includes("fono") ||
    desc.includes("caps") ||
    desc.includes("exame")
  ) {
    return { category: "LAUDO_MEDICO", label: "Entrega de Laudo / Saúde" };
  }
  if (
    desc.includes("cras") ||
    desc.includes("creas") ||
    desc.includes("conselho tutelar") ||
    desc.includes("rede") ||
    desc.includes("serp") ||
    desc.includes("promotoria") ||
    desc.includes("assistênc")
  ) {
    return { category: "REDE_PROTECAO", label: "Rede de Proteção / CRAS / CT" };
  }
  if (
    desc.includes("comparec") ||
    desc.includes("reunião") ||
    desc.includes("retorno") ||
    desc.includes("família") ||
    desc.includes("responsáv") ||
    desc.includes("mãe") ||
    desc.includes("pai")
  ) {
    return { category: "RETORNO_FAMILIAR", label: "Retorno da Família" };
  }
  if (
    desc.includes("reforço") ||
    desc.includes("avaliaç") ||
    desc.includes("prova") ||
    desc.includes("nota") ||
    desc.includes("tarefa") ||
    desc.includes("caderno") ||
    desc.includes("frequência")
  ) {
    return { category: "PEDAGOGICO", label: "Acompanhamento Pedagógico" };
  }
  return { category: "GERAL", label: "Combinado Geral" };
}
