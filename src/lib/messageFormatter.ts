/**
 * Motor de Interpolação e Adaptação Contextual de Mensagens Escolares
 * Colégio Estadual Leopoldina B. Pedroso
 */

export type SchoolShift = "MANHA" | "TARDE" | "NOITE";

export interface AttendanceContext {
  percent?: number | null;
  semanaAtual?: string | null;
  semanaAnterior?: string | null;
  variacao?: number | null;
  serpProtocol?: string | null;
  serpStatus?: string | null;
}

export interface StudentContext {
  id?: string;
  name: string;
  phone?: string;
  guardianName?: string | null;
  classGroup: {
    id?: string;
    name: string;
    segment: string; // FUNDAMENTAL | MEDIO | NOTURNO
    shift?: string;   // MANHA | TARDE | NOITE
  };
  attendance?: AttendanceContext | null;
}

export interface MessageContext {
  student: StudentContext;
  pedagogaName?: string;
  overrideShift?: SchoolShift;
  customNotes?: string;
  attendance?: AttendanceContext | null;
}

/**
 * Determina o turno padrão (MANHA, TARDE ou NOITE) considerando:
 * 1. O override explícito selecionado pela pedagoga (se houver)
 * 2. O turno registrado na turma do aluno
 * 3. O segmento da turma (ex: NOTURNO -> NOITE)
 * 4. A hora atual do envio como fallback
 */
export function determineShift(
  student?: StudentContext,
  overrideShift?: SchoolShift,
  currentHour?: number
): SchoolShift {
  if (overrideShift) return overrideShift;

  if (student?.classGroup) {
    const seg = (student.classGroup.segment || "").toUpperCase();
    const shift = (student.classGroup.shift || "").toUpperCase();

    if (seg === "NOTURNO" || shift === "NOITE") return "NOITE";
    if (shift === "MANHA" || shift === "MATUTINO") return "MANHA";
    if (shift === "TARDE" || shift === "VESPERTINO") return "TARDE";

    // Regra heurística por padrão de turma do Leopoldina se não especificado
    const name = student.classGroup.name.toUpperCase();
    if (name.includes("SÉRIE") || name.includes("SERIE")) return "NOITE";
    // Ensino Médio integrado/ADM geralmente é tarde ou manhã
    if (name.includes("ADM")) return "TARDE";
  }

  // Fallback baseado na hora local
  const hour = currentHour !== undefined ? currentHour : new Date().getHours();
  if (hour < 12) return "MANHA";
  if (hour < 18) return "TARDE";
  return "NOITE";
}

/**
 * Retorna a saudação correspondente ao turno
 */
export function getGreeting(shift: SchoolShift): string {
  switch (shift) {
    case "MANHA":
      return "Bom dia!";
    case "TARDE":
      return "Boa tarde!";
    case "NOITE":
      return "Boa noite!";
    default:
      return "Olá!";
  }
}

/**
 * Retorna o rótulo amigável do período
 */
export function getShiftLabel(shift: SchoolShift): string {
  switch (shift) {
    case "MANHA":
      return "Manhã (Matutino)";
    case "TARDE":
      return "Tarde (Vespertino)";
    case "NOITE":
      return "Noite (Noturno)";
    default:
      return "Período Escolar";
  }
}

/**
 * Formata um modelo de mensagem aplicando interpolação de variáveis
 * e adaptando saudações fixas legadas para o turno do aluno.
 */
export function formatMessage(
  prefixText: string = "",
  suffixText: string = "",
  context: MessageContext
): string {
  const shift = determineShift(context.student, context.overrideShift);
  const greeting = getGreeting(shift);
  const student = context.student;

  const responsavel = student.guardianName?.trim() || "Senhores Pais e/ou Responsáveis";
  const pedagoga = context.pedagogaName?.trim() || "Equipe Pedagógica";
  const segmento =
    student.classGroup.segment === "FUNDAMENTAL"
      ? "Ensino Fundamental"
      : student.classGroup.segment === "MEDIO"
      ? "Ensino Médio"
      : "Ensino Noturno";

  const shiftLabel =
    shift === "MANHA" ? "matutino" : shift === "TARDE" ? "vespertino" : "noturno";

  // Função interna para substituir tags e saudações legadas
  const interpolate = (text: string): string => {
    if (!text) return "";

    let res = text;

    // 1. Substituir tags explícitas de estudante e escola
    res = res.replace(/\{saudacao\}/gi, greeting);
    res = res.replace(/\{aluno\}/gi, student.name);
    res = res.replace(/\{turma\}/gi, student.classGroup.name);
    res = res.replace(/\{responsavel\}/gi, responsavel);
    res = res.replace(/\{pedagoga\}/gi, pedagoga);
    res = res.replace(/\{segmento\}/gi, segmento);
    res = res.replace(/\{periodo\}/gi, shiftLabel);
    res = res.replace(/\{turno\}/gi, shiftLabel);

    // 2. Substituir tags de Frequência do B.I. e SERP
    const att = context.attendance || student.attendance;
    const freqStr =
      att?.percent !== undefined && att?.percent !== null
        ? `${Number(att.percent).toFixed(1).replace(".", ",")}%`
        : "";
    const semAtualStr = att?.semanaAtual
      ? att.semanaAtual.includes("%")
        ? att.semanaAtual
        : `${att.semanaAtual}%`
      : "";
    const semAntStr = att?.semanaAnterior
      ? att.semanaAnterior.includes("%")
        ? att.semanaAnterior
        : `${att.semanaAnterior}%`
      : "";

    let situacaoFreq = "";
    if (att?.percent !== undefined && att?.percent !== null) {
      if (att.percent < 75) {
        situacaoFreq = "em nível crítico (abaixo do mínimo legal de 75%)";
      } else if (att.percent < 85) {
        situacaoFreq = "em estado de atenção (entre 75% e 85%)";
      } else {
        situacaoFreq = "em situação regular";
      }
    }

    const serpInfo = att?.serpProtocol
      ? `Ficha SERP nº ${att.serpProtocol}`
      : att?.serpStatus
      ? `SERP: ${att.serpStatus}`
      : "";

    res = res.replace(/\{frequencia\}/gi, freqStr || "—");
    res = res.replace(/\{media_geral\}/gi, freqStr || "—");
    res = res.replace(/\{semana_atual\}/gi, semAtualStr || "—");
    res = res.replace(/\{semana_anterior\}/gi, semAntStr || "—");
    res = res.replace(/\{situacao_frequencia\}/gi, situacaoFreq || "alerta de infrequência");
    res = res.replace(/\{protocolo_serp\}/gi, serpInfo || "—");
    res = res.replace(/\{ficha_serp\}/gi, serpInfo || "—");

    // 3. Normalização automática de saudações legadas estáticas no início do texto
    // Ex: "Boa tarde!\n", "Boa noite!\n", "Bom dia!\n", "Boa tarde, senhores pais"
    res = res.replace(/^(Boa tarde|Boa noite|Bom dia)([!,]?)/i, (_, _greet, punct) => {
      if (punct === ",") return `${greeting.replace("!", "")},`;
      return greeting;
    });

    return res;
  };

  const finalPrefix = interpolate(prefixText).trim();
  const finalSuffix = interpolate(suffixText).trim();

  // Verifica se o texto já incluiu {aluno} ou {turma} manualmente
  const hasStudentInBody =
    prefixText.toLowerCase().includes("{aluno}") ||
    suffixText.toLowerCase().includes("{aluno}");

  let output = "";

  if (finalPrefix) {
    output += finalPrefix;
  }

  // Se o modelo não usou a tag {aluno} explicitamente, insere o bloco padrão estruturado
  if (!hasStudentInBody) {
    if (output) output += "\n\n";
    output += `*Aluno(a):* ${student.name}\n*Turma:* ${student.classGroup.name}`;
  }

  if (finalSuffix) {
    output += "\n\n" + finalSuffix;
  }

  return output.trim();
}
