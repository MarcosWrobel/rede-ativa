/**
 * Utilitários puros de análise preventiva de evasão (Queda Abrupta),
 * vigência de atestados/justificativas e rótulos pedagógicos (Fase 3).
 */

export const KINSHIP_LABELS: Record<string, string> = {
  MAE: "Mãe",
  PAI: "Pai",
  AVOS: "Avô / Avó",
  TIOS: "Tio / Tia",
  IRMAOS: "Irmão / Irmã (Maior)",
  RESPONSAVEL: "Responsável Legal",
  RECADO: "Telefone de Recado",
  PROPRIO_ALUNO: "Próprio Estudante",
};

export const JUSTIFICATION_TYPE_LABELS: Record<string, string> = {
  ATESTADO_MEDICO: "Atestado Médico",
  ATESTADO_ODONTOLOGICO: "Atestado Odontológico",
  DECLARACAO_COMPARECIMENTO: "Declaração de Comparecimento (Saúde)",
  JUSTIFICATIVA_FAMILIAR: "Justificativa Familiar / Viagem / Luto",
  DISPENSA_LEGAL: "Regime Domiciliar / Amparo Legal",
};

/**
 * Gera chave de semana ISO ("YYYY-Www", ex: "2026-W44") para deduplicação semanal
 * de snapshots de frequência do Power BI.
 */
export function getIsoWeekKey(date: Date = new Date()): string {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/**
 * Extrai métricas estruturadas (CGM, Semana Atual, Semana Anterior e Variação)
 * a partir do campo enrollmentDetail sincronizado pelo Power BI.
 */
export function parseEnrollmentDetailMetrics(detail?: string | null) {
  if (!detail) {
    return {
      cgm: null as string | null,
      semanaAtual: null as string | null,
      semanaAnterior: null as string | null,
      weeklyNum: null as number | null,
      prevWeeklyNum: null as number | null,
      variacao: null as number | null,
    };
  }

  const cgmMatch = detail.match(/CGM:\s*([^\s|]+)/);
  const atualMatch = detail.match(/Semana Atual:\s*([^\s|]+)/);
  const antMatch = detail.match(/Semana Anterior:\s*([^\s|]+)/);

  const semanaAtual = atualMatch ? atualMatch[1] : null;
  const semanaAnterior = antMatch ? antMatch[1] : null;
  const cgm = cgmMatch ? cgmMatch[1] : null;

  const toNum = (s: string | null) => {
    if (!s) return null;
    const n = parseFloat(s.replace("%", "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };

  const weeklyNum = toNum(semanaAtual);
  const prevWeeklyNum = toNum(semanaAnterior);

  let variacao: number | null = null;
  if (weeklyNum !== null && prevWeeklyNum !== null) {
    variacao = +(weeklyNum - prevWeeklyNum).toFixed(1);
  }

  return {
    cgm,
    semanaAtual,
    semanaAnterior,
    weeklyNum,
    prevWeeklyNum,
    variacao,
  };
}

export interface AbruptDropAnalysis {
  isAbruptDrop: boolean;
  dropDelta: number | null;
  reason: string | null;
}

/**
 * Detecta risco precoce de evasão ("Queda Abrupta Recente") combinando:
 * 1) Variação entre semana atual e semana anterior <= -20 p.p.
 * 2) Frequência da semana atual <= 50% (mesmo se o acumulado anual ainda for >= 75%)
 * 3) Queda >= 4 p.p. no acumulado geral entre os 2 snapshots históricos mais recentes
 */
export function detectAbruptDrop(params: {
  attendancePercent: number;
  weeklyPercent?: number | null;
  previousWeeklyPercent?: number | null;
  snapshots?: Array<{ attendancePercent: number; weeklyPercent?: number | null }>;
}): AbruptDropAnalysis {
  const { attendancePercent, weeklyPercent, previousWeeklyPercent, snapshots = [] } = params;

  if (
    weeklyPercent !== undefined &&
    weeklyPercent !== null &&
    previousWeeklyPercent !== undefined &&
    previousWeeklyPercent !== null
  ) {
    const delta = +(weeklyPercent - previousWeeklyPercent).toFixed(1);
    if (delta <= -20) {
      return {
        isAbruptDrop: true,
        dropDelta: delta,
        reason: `Queda semanal de ${delta}% (${previousWeeklyPercent}% → ${weeklyPercent}%)`,
      };
    }
  }

  if (weeklyPercent !== undefined && weeklyPercent !== null && weeklyPercent <= 50) {
    return {
      isAbruptDrop: true,
      dropDelta:
        previousWeeklyPercent !== undefined && previousWeeklyPercent !== null
          ? +(weeklyPercent - previousWeeklyPercent).toFixed(1)
          : null,
      reason:
        attendancePercent >= 75
          ? `Alerta precoce: semana atual em ${weeklyPercent}% (acumulado ${attendancePercent.toFixed(1)}%)`
          : `Ausência severa na semana atual (${weeklyPercent}%)`,
    };
  }

  if (snapshots.length >= 2) {
    // Assumindo snapshots ordenados do mais recente [0] para o anterior [1]
    const newest = snapshots[0];
    const previous = snapshots[1];
    const cumulativeDelta = +(newest.attendancePercent - previous.attendancePercent).toFixed(1);
    if (cumulativeDelta <= -4) {
      return {
        isAbruptDrop: true,
        dropDelta: cumulativeDelta,
        reason: `Queda de ${cumulativeDelta}% na média acumulada em relação à coleta anterior`,
      };
    }
  }

  return {
    isAbruptDrop: false,
    dropDelta:
      weeklyPercent !== undefined &&
      weeklyPercent !== null &&
      previousWeeklyPercent !== undefined &&
      previousWeeklyPercent !== null
        ? +(weeklyPercent - previousWeeklyPercent).toFixed(1)
        : null,
    reason: null,
  };
}

export interface JustificationLike {
  id?: string;
  type: string;
  startDate: Date | string;
  endDate: Date | string;
  notes?: string | null;
  cidCode?: string | null;
}

function toLocalDayString(d: Date | string): string {
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return d;
  }
  const dt = new Date(d);
  // Ajusta para fuso de Brasília (-03:00) para comparar datas civis sem desvio de meia-noite UTC
  const brTime = new Date(dt.getTime() - 3 * 60 * 60 * 1000);
  return brTime.toISOString().slice(0, 10);
}

/**
 * Retorna o atestado/justificativa vigente na data de referência (se houver).
 */
export function getActiveJustification<T extends JustificationLike>(
  justifications: T[] | undefined | null,
  referenceDate: Date = new Date()
): T | null {
  if (!justifications || justifications.length === 0) return null;
  const refDay = toLocalDayString(referenceDate);

  const active = justifications.filter((j) => {
    const startDay = toLocalDayString(j.startDate);
    const endDay = toLocalDayString(j.endDate);
    return startDay <= refDay && refDay <= endDay;
  });

  if (active.length === 0) return null;

  // Prioriza o que termina mais tarde
  return active.sort((a, b) =>
    toLocalDayString(b.endDate).localeCompare(toLocalDayString(a.endDate))
  )[0];
}
