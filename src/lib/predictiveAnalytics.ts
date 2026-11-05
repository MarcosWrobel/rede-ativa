export interface CauseBreakdownItem {
  category: string;
  count: number;
  percentage: number;
}

export interface PredictiveRecommendation {
  priority: "HIGH" | "MEDIUM" | "INFO";
  title: string;
  action: string;
}

export interface PredictiveAnalysisResult {
  totalCategorizedReplies: number;
  criticalRate: number;
  causesBreakdown: CauseBreakdownItem[];
  recommendations: PredictiveRecommendation[];
}

export const CATEGORY_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  SAUDE: {
    label: "Problemas de Saúde / Atestados",
    color: "text-rose-700",
    bg: "bg-rose-50 border-rose-200",
  },
  TRANSPORTE: {
    label: "Transporte Escolar Rural / Linhas",
    color: "text-amber-700",
    bg: "bg-amber-50 border-amber-200",
  },
  TRABALHO: {
    label: "Trabalho Infantil / Precoce",
    color: "text-red-700",
    bg: "bg-red-50 border-red-200",
  },
  VULNERABILIDADE: {
    label: "Vulnerabilidade Socioeconômica / Familiar",
    color: "text-purple-700",
    bg: "bg-purple-50 border-purple-200",
  },
  OUTROS: {
    label: "Outros Motivos Diversificados",
    color: "text-slate-700",
    bg: "bg-slate-50 border-slate-200",
  },
};

export function getCategoryMeta(category: string) {
  const norm = (category || "").toUpperCase();
  return (
    CATEGORY_LABELS[norm] || {
      label: category || "Não categorizado",
      color: "text-slate-700",
      bg: "bg-slate-50 border-slate-200",
    }
  );
}

/**
 * Gera recomendações analíticas de políticas públicas a partir do cruzamento de
 * causas de infrequência escolar comunicadas pelas famílias.
 */
export function generatePredictiveRecommendations(
  causesBreakdown: CauseBreakdownItem[],
  criticalRate: number = 0
): PredictiveRecommendation[] {
  const recommendations: PredictiveRecommendation[] = [];

  const saudeCase = causesBreakdown.find((c) => c.category === "SAUDE");
  const transporteCase = causesBreakdown.find((c) => c.category === "TRANSPORTE");
  const trabalhoCase = causesBreakdown.find((c) => c.category === "TRABALHO");
  const vulnerabilidadeCase = causesBreakdown.find((c) => c.category === "VULNERABILIDADE");

  // 1. Alerta máximo: Trabalho infantil detectado
  if (trabalhoCase && trabalhoCase.count > 0) {
    recommendations.push({
      priority: "HIGH",
      title: "Alerta Crítico: Risco de Trabalho Infantil",
      action: `Identificados ${trabalhoCase.count} registros vinculados a trabalho precoce. Necessário acionamento imediato da Rede de Proteção (CRAS/CREAS/Conselho Tutelar) para resguardo legal das crianças e adolescentes conforme Art. 56 do ECA.`,
    });
  }

  // 2. Gargalo logístico: Transporte escolar rural
  if (transporteCase && (transporteCase.percentage > 20 || transporteCase.count >= 5)) {
    recommendations.push({
      priority: "HIGH",
      title: "Gargalo no Transporte Escolar Municipal",
      action: `O transporte é responsável por ${transporteCase.percentage}% das infrequências justificadas (${transporteCase.count} casos). Recomenda-se auditoria imediata das linhas rurais, revisão de itinerários e manutenção preventiva da frota escolar para evitar evasão involuntária.`,
    });
  }

  // 3. Questões de saúde e epidemias locais
  if (saudeCase && (saudeCase.percentage > 30 || saudeCase.count >= 10)) {
    recommendations.push({
      priority: "MEDIUM",
      title: "Incidência Alta de Afastamentos por Saúde",
      action: `Problemas de saúde representam ${saudeCase.percentage}% dos motivos relatados (${saudeCase.count} casos). Sugere-se articulação intersetorial com a Secretaria de Saúde para mutirões de imunização, verificação odontológica e atendimento clínico prioritário.`,
    });
  }

  // 4. Vulnerabilidade e insegurança alimentar
  if (vulnerabilidadeCase && vulnerabilidadeCase.count > 0) {
    recommendations.push({
      priority: "MEDIUM",
      title: "Acompanhamento Social / Vulnerabilidade Familiar",
      action: `Há ${vulnerabilidadeCase.count} casos decorrentes de extrema vulnerabilidade familiar. Sugere-se inclusão prioritária nos programas municipais de assistência social, fornecimento de cestas básicas e visita domiciliar do Serviço Social.`,
    });
  }

  // 5. Taxa Crítica de infrequência geral da rede
  if (criticalRate > 15) {
    recommendations.push({
      priority: "HIGH",
      title: "Taxa Crítica da Rede Elevada (>15%)",
      action: `A proporção de alunos com infrequência abaixo de 75% atingiu ${criticalRate}%. Recomenda-se a criação de uma força-tarefa municipal com visitas domiciliares integradas da Busca Ativa em conjunto com a Secretaria de Ação Social.`,
    });
  }

  // 6. Caso regular
  if (recommendations.length === 0) {
    recommendations.push({
      priority: "INFO",
      title: "Monitoramento Preventivo Regular",
      action:
        "As causas de infrequência da rede encontram-se dentro dos parâmetros previstos. Manter o acompanhamento semanal e a busca ativa continuada via WhatsApp e contatos telefônicos.",
    });
  }

  return recommendations;
}
