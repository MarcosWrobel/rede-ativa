import { z } from "zod";

export function formatZodError(error: z.ZodError): string {
  return error.issues.map((i) => i.message).join("; ");
}

export const studentCreateSchema = z.object({
  cgm: z.string().trim().optional().nullable(),
  name: z.string().trim().min(2, "Nome do aluno deve ter pelo menos 2 caracteres"),
  guardianName: z.string().optional().nullable(),
  phone: z
    .string()
    .trim()
    .refine((val) => val.replace(/\D/g, "").length >= 8, {
      message: "Informe um telefone válido com DDD (mínimo 8 dígitos)",
    }),
  classGroupId: z.string().trim().min(1, "Turma é obrigatória"),
});

export const studentUpdateSchema = z.object({
  id: z.string().trim().min(1, "ID do aluno é obrigatório"),
  cgm: z.string().trim().optional().nullable(),
  name: z.string().trim().min(2, "Nome inválido").optional(),
  guardianName: z.string().optional().nullable(),
  phone: z
    .string()
    .trim()
    .refine((val) => val === "" || val.replace(/\D/g, "").length >= 8, {
      message: "Telefone inválido (informe ao menos 8 dígitos com DDD ou deixe em branco)",
    })
    .optional(),
  classGroupId: z.string().trim().min(1).optional(),
});

export const classGroupCreateSchema = z.object({
  name: z.string().trim().min(2, "Nome da turma deve ter pelo menos 2 caracteres"),
  segment: z.enum(["FUNDAMENTAL", "MEDIO", "NOTURNO", "INFANTIL", "EJA"]).default("FUNDAMENTAL"),
  shift: z.enum(["MANHA", "TARDE", "NOITE", "INTEGRAL"]).default("MANHA"),
});

export const sereBatchImportSchema = z.object({
  turmas: z
    .array(
      z.object({
        tempId: z.string().trim().min(1),
        name: z.string().trim().min(1, "Nome da turma não pode ser vazio"),
        targetClassGroupId: z.string().trim().min(1).optional(),
        sourceIdentity: z.string().trim().optional(),
        segment: z.enum(["FUNDAMENTAL", "MEDIO", "NOTURNO"]),
        shift: z.enum(["MANHA", "TARDE", "NOITE"]),
      })
    )
    .min(1, "Selecione ao menos uma turma para importar.")
    .max(500, "Limite máximo de 500 turmas por lote excedido."),
  students: z
    .array(
      z.object({
        cgm: z.string().trim().optional().nullable(),
        name: z.string().trim().min(2),
        phone: z.string().trim().optional().default(""),
        guardianName: z.string().trim().optional().nullable(),
        turmaTempId: z.string().trim().min(1),
      })
    )
    .min(1, "Nenhum aluno elegível para importação nas turmas selecionadas.")
    .max(5000, "Limite máximo de 5.000 estudantes por lote excedido."),
  transferredStudents: z
    .array(
      z.object({
        cgm: z.string().trim().optional().nullable(),
        name: z.string().trim().min(2),
      })
    )
    .max(5000, "Limite máximo de 5.000 transferidos por lote excedido.")
    .optional()
    .default([]),
  options: z
    .object({
      updateExisting: z.boolean().default(true),
      deactivateTransferred: z.boolean().default(true),
      updateSchoolInfo: z.boolean().optional().default(false),
      schoolInfo: z
        .object({
          name: z.string().trim().min(2),
          city: z.string().trim().optional().default(""),
        })
        .optional()
        .nullable(),
    })
    .optional()
    .default({
      updateExisting: true,
      deactivateTransferred: true,
      updateSchoolInfo: false,
      schoolInfo: null,
    }),
});

export const templateCreateSchema = z.object({
  title: z.string().trim().min(2, "Título do modelo é obrigatório"),
  segment: z.enum(["TODOS", "FUNDAMENTAL", "MEDIO", "NOTURNO"]).optional().default("TODOS"),
  prefixText: z.string().optional().default(""),
  suffixText: z.string().optional().default(""),
  isAbsenceRelated: z.boolean().optional().default(false),
});

export const templateUpdateSchema = z.object({
  id: z.string().trim().min(1, "ID do modelo é obrigatório"),
  title: z.string().trim().min(2, "Título inválido").optional(),
  segment: z.enum(["TODOS", "FUNDAMENTAL", "MEDIO", "NOTURNO"]).optional(),
  prefixText: z.string().optional(),
  suffixText: z.string().optional(),
  isAbsenceRelated: z.boolean().optional(),
  active: z.boolean().optional(),
});

export const deliveryStatusEnum = z.enum([
  "QUEUED",
  "DISPATCHING",
  "LINK_OPENED",
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED_NO_WHATSAPP",
]);

export const initialDeliveryStatusEnum = z.enum([
  "QUEUED",
  "DISPATCHING",
  "LINK_OPENED",
  "SENT",
  "FAILED_NO_WHATSAPP",
]);

export const replyCategoryEnum = z.enum([
  "SAUDE",
  "TRANSPORTE",
  "TRABALHO",
  "VIAGEM_FAMILIAR",
  "VULNERABILIDADE",
  "SEM_JUSTIFICATIVA",
  "OUTROS",
]);

export const messageSendSchema = z.object({
  studentId: z.string().trim().min(1, "Aluno é obrigatório").max(100),
  templateId: z.string().trim().max(100).optional().nullable(),
  reasonTitle: z.string().trim().min(1, "Motivo é obrigatório").max(300),
  messageContent: z.string().trim().min(2, "Conteúdo da mensagem é obrigatório").max(10_000),
  customPhone: z.string().trim().max(30).optional().nullable(),
  initialDeliveryStatus: initialDeliveryStatusEnum.optional(),
});

export const messageDeliveryStatusUpdateSchema = z.object({
  logId: z.string().trim().min(1, "ID do registro é obrigatório").max(100),
  deliveryStatus: deliveryStatusEnum,
});

export const messageReplySchema = z.object({
  logId: z.string().trim().min(1, "ID do registro é obrigatório").max(100),
  guardianReplied: z.boolean(),
  replyNotes: z.string().max(4000).optional().nullable(),
  replyCategory: replyCategoryEnum.optional().nullable(),
  rawReply: z.string().max(10_000).optional().nullable(),
  extractedAt: z.union([z.string(), z.date()]).optional().nullable(),
  sourceMethod: z.enum(["MANUAL", "EXTENSION_ASSISTED"]).optional().default("MANUAL"),
  classifyWithAi: z.boolean().optional().default(false),
});

export const messageManageUpdateSchema = z.object({
  id: z.string().trim().min(1, "ID do registro é obrigatório").max(100),
  sentAt: z.union([z.string(), z.date()]).optional(),
  reasonTitle: z.string().trim().min(1).max(300).optional(),
  phoneUsed: z.string().trim().min(8).max(30).optional(),
  sentByName: z.string().trim().min(1).max(200).optional(),
  guardianReplied: z.boolean().optional(),
  replyNotes: z.string().max(4000).optional().nullable(),
  replyCategory: replyCategoryEnum.optional().nullable(),
  deliveryStatus: deliveryStatusEnum.optional(),
  messageContent: z.string().trim().min(1).max(10_000).optional(),
});

export const messageManageDeleteSchema = z.object({
  id: z.string().trim().min(1, "ID do registro é obrigatório").max(100),
});

export const aiClassifyReplySchema = z
  .object({
    rawReply: z.string().trim().max(10_000).optional().default(""),
    screenshotDataUrl: z.string().max(6_000_000).optional().nullable(),
    studentName: z.string().trim().max(200).optional().nullable(),
    guardianName: z.string().trim().max(200).optional().nullable(),
    reasonTitle: z.string().trim().max(300).optional().nullable(),
  })
  .refine(
    (d) =>
      d.rawReply.length >= 3 ||
      Boolean(d.screenshotDataUrl && d.screenshotDataUrl.startsWith("data:image/")),
    {
      message:
        "Cole ou digite ao menos uma frase informada pelo responsável para classificar.",
    }
  );

export const frequenciaSyncItemSchema = z.object({
  cgm: z.union([z.string(), z.number()]).optional().nullable(),
  nome: z.string().optional().nullable(),
  turma: z.string().optional().nullable(),
  mediaGeral: z.union([z.string(), z.number()]).optional().nullable(),
  frequencia: z.union([z.string(), z.number()]).optional().nullable(),
  semanaAtual: z.union([z.string(), z.number()]).optional().nullable(),
  semanaAnterior: z.union([z.string(), z.number()]).optional().nullable(),
  amparoLegalVigencia: z.string().optional().nullable(),
  deficienciaAltasHabilidades: z.union([z.boolean(), z.number(), z.string()]).optional().nullable(),
  ganhandoMundo: z.union([z.boolean(), z.number(), z.string()]).optional().nullable(),
  serpAtivo: z.union([z.boolean(), z.number(), z.string()]).optional().nullable(),
  idade: z.union([z.number(), z.string()]).optional().nullable(),
});

export const frequenciaSyncSchema = z.object({
  alunos: z.array(frequenciaSyncItemSchema).min(1, "Nenhum aluno fornecido para sincronização."),
});

export const serpSyncItemSchema = z.object({
  cgm: z.union([z.string(), z.number()]).optional().nullable(),
  nome: z.string().optional().nullable(),
  turma: z.string().optional().nullable(),
  numeroFicha: z.union([z.string(), z.number()]).optional().nullable(),
  protocolo: z.union([z.string(), z.number()]).optional().nullable(),
  status: z.string().optional().nullable(),
  situacao: z.string().optional().nullable(),
  dataAbertura: z.string().optional().nullable(),
  acoesRealizadas: z.string().optional().nullable(),
  motivo: z.string().optional().nullable(),
  observacoes: z.string().optional().nullable(),
  detalhes: z.any().optional().nullable(),
});

const PUBLIC_EMAIL_DOMAINS = ["gmail.com", "hotmail.com", "yahoo.com", "outlook.com", "live.com", "bol.com.br", "uol.com.br"];

export const userCreateSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Formato de e-mail inválido")
    .refine(
      (e) => {
        const domain = e.split("@")[1] || "";
        return (
          e.endsWith(".gov.br") ||
          e.endsWith(".edu.br") ||
          !PUBLIC_EMAIL_DOMAINS.includes(domain)
        );
      },
      {
        message: "O e-mail deve ser institucional (ex: @escola.pr.gov.br, @tibagi.pr.gov.br ou domínio próprio da mantenedora)",
      }
    ),
  name: z.string().trim().optional().default(""),
  role: z
    .enum(["PEDAGOGA", "GESTOR_ESCOLAR", "GESTAO_SECRETARIA", "ADMIN", "SUPERADMIN"])
    .optional()
    .default("PEDAGOGA"),
});

export const kinshipEnum = z.enum([
  "MAE",
  "PAI",
  "AVOS",
  "TIOS",
  "IRMAOS",
  "RESPONSAVEL",
  "RECADO",
  "PROPRIO_ALUNO",
]);

export const studentContactCreateSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do responsável/contato"),
  kinship: kinshipEnum.optional().default("RESPONSAVEL"),
  phone: z
    .string()
    .trim()
    .refine((val) => val.replace(/\D/g, "").length >= 8, {
      message: "Informe um telefone válido com DDD (mínimo 8 dígitos)",
    }),
  isPrimary: z.boolean().optional().default(false),
  whatsappValid: z.boolean().optional().default(true),
  notes: z.string().trim().optional().nullable(),
});

export const studentContactUpdateSchema = z.object({
  contactId: z.string().trim().min(1, "ID do contato é obrigatório"),
  name: z.string().trim().min(2, "Nome inválido").optional(),
  kinship: kinshipEnum.optional(),
  phone: z
    .string()
    .trim()
    .refine((val) => val.replace(/\D/g, "").length >= 8, {
      message: "Telefone inválido",
    })
    .optional(),
  isPrimary: z.boolean().optional(),
  whatsappValid: z.boolean().optional(),
  notes: z.string().trim().optional().nullable(),
});

export const justificationTypeEnum = z.enum([
  "ATESTADO_MEDICO",
  "ATESTADO_ODONTOLOGICO",
  "DECLARACAO_COMPARECIMENTO",
  "JUSTIFICATIVA_FAMILIAR",
  "DISPENSA_LEGAL",
]);

export const justificationCreateSchema = z
  .object({
    type: justificationTypeEnum.optional().default("ATESTADO_MEDICO"),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inicial inválida"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data final inválida"),
    cidCode: z.string().trim().max(20).optional().nullable(),
    notes: z.string().trim().optional().nullable(),
  })
  .refine((d) => d.startDate <= d.endDate, {
    message: "A data final do atestado não pode ser anterior à data inicial",
  });

export const inPersonAttendanceCreateSchema = z.object({
  attendedAt: z.string().min(10, "Data do atendimento é obrigatória"),
  guardianPresent: z.string().trim().min(2, "Informe o familiar/responsável presente"),
  subject: z.string().trim().min(3, "Informe a pauta/assunto do atendimento"),
  summary: z.string().trim().min(5, "Descreva o resumo/relato do atendimento presencial"),
  agreements: z.string().trim().optional().nullable(),
});

// ---------------------------------------------------------------------------
// ACOMPANHAMENTO TRIMESTRAL DE TURMAS, CONSELHO DE CLASSE E PÓS-CONSELHO
// ---------------------------------------------------------------------------

export const councilTrimesterEnum = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const councilEnrollmentStatusEnum = z.enum([
  "ATIVO",
  "TRANSFERIDO",
  "REMANEJADO",
  "ABANDONO",
]);

export const councilSeatingMapModeEnum = z.enum([
  "SEMANAL",
  "REVEZAMENTO_MENSAL",
  "FIXO",
  "PERSONALIZADO",
]);

export const councilStudentTagEnum = z.enum([
  "ALUNO_COM_LAUDO",
  "AEE",
  "ESTUDANTE_MONITOR",
  "LIDER_DE_TURMA",
  "DESTAQUE_DA_TURMA",
  "ESTUDANTE_SUPERACAO",
  "DESTAQUE_INTEGRADO_NOTA_INTEGRA",
]);

export const councilDescriptorCodeSchema = z.number().int().min(1).max(5);

export const councilTeacherDeskPositionEnum = z.enum(["LEFT", "CENTER", "RIGHT"]);

export const councilDoorSideEnum = z.enum(["LEFT", "RIGHT", "NONE"]);

export const councilSeatingMapSeatSchema = z.object({
  col: z.number().int().min(0).max(7),
  row: z.number().int().min(0).max(11),
  studentId: z.string().trim().min(1).max(100).nullable(),
  blocked: z.boolean().optional(),
});

export const councilSeatingMapVersionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1, "Nome do mapa é obrigatório").max(100),
  effectiveDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida")
    .nullable()
    .optional(),
  columns: z.number().int().min(2).max(8),
  rows: z.number().int().min(1).max(12),
  teacherDeskPosition: councilTeacherDeskPositionEnum.default("CENTER"),
  doorSide: councilDoorSideEnum.default("LEFT"),
  notes: z.string().trim().max(1000).nullable().optional(),
  seats: z.array(councilSeatingMapSeatSchema).max(96),
  createdAt: z.string().trim().min(1).max(64),
  updatedAt: z.string().trim().min(1).max(64),
});

export const councilSeatingMapLayoutSchema = z.object({
  version: z.literal(1),
  activeMapId: z.string().trim().min(1).max(80).nullable(),
  maps: z.array(councilSeatingMapVersionSchema).max(24),
});

export const councilBoardUpsertSchema = z.object({
  classGroupId: z.string().trim().min(1, "Turma é obrigatória").max(100),
  year: z.number().int().min(2024).max(2100),
  peerLeaderStudentId: z.string().trim().max(100).optional().nullable(),
  peerLeaderName: z.string().trim().max(200).optional().nullable(),
  teacherLeaderStudentId: z.string().trim().max(100).optional().nullable(),
  teacherLeaderName: z.string().trim().max(200).optional().nullable(),
  externalEvalEd1Percent: z.number().min(0).max(100).optional().nullable(),
  externalEvalEd2Percent: z.number().min(0).max(100).optional().nullable(),
  externalEvalEd3Percent: z.number().min(0).max(100).optional().nullable(),
  seatingMapMode: councilSeatingMapModeEnum.optional().default("REVEZAMENTO_MENSAL"),
  seatingMapNotes: z.string().trim().max(2000).optional().nullable(),
  seatingMapLayout: councilSeatingMapLayoutSchema.optional().nullable(),
});

export const councilBoardMetadataUpdateSchema = councilBoardUpsertSchema.partial().omit({
  classGroupId: true,
  year: true,
});

export const councilSubjectItemSchema = z.object({
  id: z.string().trim().max(100).optional(),
  name: z.string().trim().min(2, "Nome do componente é obrigatório").max(120),
  teacherName: z.string().trim().max(200).optional().nullable(),
  teacherEmail: z
    .string()
    .trim()
    .email("E-mail docente inválido")
    .max(200)
    .optional()
    .nullable()
    .or(z.literal("")),
  displayOrder: z.number().int().min(0).max(100).default(0),
  active: z.boolean().default(true),
});

export const councilSubjectsBatchSchema = z
  .object({
    sourceBoardId: z.string().trim().min(1).max(100).optional().nullable(),
    subjects: z
      .array(councilSubjectItemSchema)
      .max(40, "Limite máximo de 40 componentes por turma.")
      .optional(),
  })
  .refine(
    (d) => Boolean(d.sourceBoardId) || (Array.isArray(d.subjects) && d.subjects.length >= 1),
    {
      message:
        "Informe ao menos um componente curricular ou selecione uma turma de origem para importar.",
    }
  );

const councilPreCouncilDateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const councilPostActionItemSchema = z.object({
  number: z.number().int().min(1).max(50),
  description: z.string().trim().min(2, "Descrição do encaminhamento é obrigatória").max(1000),
  responsible: z.enum(["FAMILIA", "ESTUDANTE", "ESCOLA", "REDE_PROTECAO"]).default("ESCOLA"),
  dueDate: z
    .string()
    .trim()
    .regex(councilPreCouncilDateRegex, "Prazo inválido (use AAAA-MM-DD)")
    .optional()
    .nullable()
    .or(z.literal("")),
});

export const councilPreCouncilConversationSchema = z.object({
  id: z.string().trim().min(1).max(100),
  subjectId: z.string().trim().min(1).max(100).optional().nullable(),
  subjectName: z.string().trim().min(1, "Nome do componente é obrigatório").max(160),
  teacherName: z.string().trim().max(200).optional().default(""),
  teacherEmail: z
    .string()
    .trim()
    .email("E-mail docente inválido")
    .max(200)
    .optional()
    .nullable()
    .or(z.literal("")),
  monitoredStudentIds: z
    .array(z.string().trim().min(1).max(100))
    .max(120)
    .optional()
    .default([])
    .transform((arr) => Array.from(new Set(arr))),
  monitoredStudentsNotes: z.string().trim().max(3000).optional().default(""),
  agreements: z.string().trim().max(3000).optional().default(""),
  conversationStatus: z.enum(["PENDING", "COMPLETED"]).optional().default("PENDING"),
  conversationDate: z
    .string()
    .trim()
    .regex(councilPreCouncilDateRegex, "Data inválida (use AAAA-MM-DD)")
    .optional()
    .nullable()
    .or(z.literal("")),
  teacherSubmittedAt: z.string().trim().max(64).optional().nullable(),
});

export const councilPreCouncilSynthesisSchema = z.object({
  mainDifficulties: z.string().trim().max(4000).optional().default(""),
  priorityStudents: z.string().trim().max(4000).optional().default(""),
  attendanceIssues: z.string().trim().max(4000).optional().default(""),
  behaviorIssues: z.string().trim().max(4000).optional().default(""),
  pedagogicalActions: z.string().trim().max(4000).optional().default(""),
});

export const councilPreCouncilSchema = z.object({
  version: z.literal(1).default(1),
  periodLabel: z.string().trim().min(1, "Informe o período de referência").max(120),
  objectiveText: z.string().trim().max(2000).optional().default(""),
  responsiblePedagogueName: z.string().trim().max(200).optional().default(""),
  responsiblePedagogueRole: z
    .string()
    .trim()
    .max(120)
    .optional()
    .default("Pedagoga Responsável"),
  conversations: z.array(councilPreCouncilConversationSchema).max(60),
  synthesis: councilPreCouncilSynthesisSchema,
});

export const councilTrimesterUpdateSchema = z.object({
  trimester: councilTrimesterEnum,
  status: z.enum(["IN_PROGRESS", "CONSOLIDATED"]).optional(),
  positivePoints: z.string().trim().max(5000).optional().nullable(),
  attentionPoints: z.string().trim().max(5000).optional().nullable(),
  plannedActions: z.string().trim().max(5000).optional().nullable(),
  preCouncil: councilPreCouncilSchema.nullable().optional(),
  postCouncilHeldAt: z.string().optional().nullable(),
  postCouncilAdvances: z.string().trim().max(4000).optional().nullable(),
  postCouncilWhatWorked: z.string().trim().max(4000).optional().nullable(),
  postCouncilRecognizedAttitudes: z.string().trim().max(4000).optional().nullable(),
  postCouncilCriticalSubjects: z.string().trim().max(4000).optional().nullable(),
  postCouncilPerformanceFactors: z.string().trim().max(4000).optional().nullable(),
  postCouncilBehaviorAttendance: z.string().trim().max(4000).optional().nullable(),
  postCouncilWhatToImprove: z.string().trim().max(4000).optional().nullable(),
  postCouncilHowTeachersCanHelp: z.string().trim().max(4000).optional().nullable(),
  postCouncilCommitments: z.string().trim().max(4000).optional().nullable(),
  postCouncilActionItems: z.array(councilPostActionItemSchema).max(30).optional(),
});

export const councilBelowAvgItemSchema = z.object({
  subjectId: z.string().trim().max(100).optional().nullable(),
  subjectName: z.string().trim().min(1).max(120),
  grade: z.number().min(0).max(100).nullable(),
});

export const councilStudentCardUpdateSchema = z.object({
  studentId: z.string().trim().min(1).max(100),
  enrollmentStatus: councilEnrollmentStatusEnum.optional(),
  externalEvalEd1Percent: z.number().min(0).max(100).optional().nullable(),
  externalEvalEd2Percent: z.number().min(0).max(100).optional().nullable(),
  externalEvalEd3Percent: z.number().min(0).max(100).optional().nullable(),
  tags: z.array(councilStudentTagEnum).max(7).optional(),
  trimester: councilTrimesterEnum.optional(),
  qualitativeOpinion: z.string().trim().max(4000).optional().nullable(),
  belowAverageSubjects: z.array(councilBelowAvgItemSchema).max(30).optional(),
});

export const councilMatrixBatchSaveSchema = z.object({
  trimester: councilTrimesterEnum,
  entries: z
    .array(
      z.object({
        studentId: z.string().trim().min(1).max(100),
        subjectId: z.string().trim().min(1).max(100),
        descriptorCodes: z
          .array(councilDescriptorCodeSchema)
          .max(5)
          .transform((arr) => Array.from(new Set(arr)).sort((a, b) => a - b)),
        grade: z.number().min(0).max(100).optional().nullable(),
      })
    )
    .min(1, "Informe ao menos um lançamento na matriz.")
    .max(1500, "Limite máximo de 1.500 células por lote excedido."),
});

export const councilGenerateMinuteSchema = z.object({
  source: z.enum(["POST_COUNCIL", "STUDENT_DELIBERATION"]),
  trimester: councilTrimesterEnum,
  studentIds: z.array(z.string().trim().min(1).max(100)).max(100).optional().default([]),
  isConfidential: z.boolean().optional(),
});

export const councilTeacherLinkCreateSchema = z.object({
  trimester: councilTrimesterEnum,
  subjectId: z.string().trim().min(1).max(100).optional().nullable(),
  expiresInDays: z.number().int().min(1).max(30).optional().default(7),
});

export const councilPreCouncilLinkCreateSchema = z.object({
  trimester: councilTrimesterEnum,
  conversationId: z.string().trim().min(1).max(100).optional().nullable(),
  expiresInDays: z.number().int().min(1).max(30).optional().default(7),
});

export const councilTeacherPortalPreCouncilContributionSchema = z.object({
  monitoredStudentIds: z
    .array(z.string().trim().min(1).max(100))
    .max(120)
    .optional()
    .default([])
    .transform((arr) => Array.from(new Set(arr))),
  monitoredStudentsNotes: z.string().trim().max(3000).optional().default(""),
});

export const councilTeacherPortalEntrySchema = z.object({
  studentId: z.string().trim().min(1).max(100),
  descriptorCodes: z
    .array(councilDescriptorCodeSchema)
    .max(5)
    .transform((arr) => Array.from(new Set(arr)).sort((a, b) => a - b)),
});

export const councilPreCouncilAckSubmitSchema = z
  .object({
    googleIdToken: z.string().trim().min(1, "Credencial Google institucional é obrigatória."),
    conversationId: z.string().trim().min(1).max(100).optional(),
    subjectId: z.string().trim().min(1).max(100).optional(),
    entries: z
      .array(councilTeacherPortalEntrySchema)
      .max(200, "Limite máximo de estudantes por turma excedido.")
      .optional(),
    preCouncil: councilTeacherPortalPreCouncilContributionSchema.optional(),
    confirmAck: z.boolean().optional(),
  })
  .refine((d) => Boolean(d.conversationId) || Boolean(d.subjectId), {
    message: "Selecione o componente curricular.",
  });

export const councilTeacherPortalAuthSchema = z.object({
  googleIdToken: z.string().trim().min(1, "Credencial Google institucional é obrigatória."),
});

export const councilTeacherPortalSubmitSchema = z
  .object({
    googleIdToken: z.string().trim().min(1, "Credencial Google institucional é obrigatória."),
    subjectId: z.string().trim().min(1, "Selecione o componente curricular.").max(100),
    entries: z
      .array(councilTeacherPortalEntrySchema)
      .max(200, "Limite máximo de estudantes por turma excedido.")
      .optional(),
    preCouncil: councilTeacherPortalPreCouncilContributionSchema.optional(),
    confirmAck: z.boolean().optional().default(false),
  })
  .refine(
    (d) =>
      (Array.isArray(d.entries) && d.entries.length > 0) ||
      d.preCouncil !== undefined ||
      d.confirmAck === true,
    {
      message:
        "Informe ao menos um estudante para salvar ou confirme a ciência do Pré-Conselho.",
    }
  );

// ---------------------------------------------------------------------------
// SINCRONIZAÇÃO DO BI APRENDIZAGEM ESTADUAL (EXTENSÃO POWER BI -> CONSELHO)
// ---------------------------------------------------------------------------

/**
 * Converte string numérica PT-BR ("5,8", "10,0", "1.234,5") ou number em float arredondado a 2 casas.
 * Retorna `null` para valores ausentes/hífens e `NaN` para strings inválidas.
 */
export function parsePtBrDecimal(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "number") {
    return Number.isFinite(val) ? Math.round(val * 100) / 100 : NaN;
  }
  if (typeof val !== "string") return NaN;

  const trimmed = val.replace(/\u0000/g, "").replace(/%/g, "").trim();
  if (!trimmed || trimmed === "-" || trimmed === "--") return null;

  let normalized = trimmed.replace(/\s+/g, "");
  if (normalized.includes(",") && normalized.includes(".")) {
    if (normalized.lastIndexOf(",") > normalized.lastIndexOf(".")) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (normalized.includes(",")) {
    normalized = normalized.replace(",", ".");
  }

  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    return NaN;
  }

  const num = Number(normalized);
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : NaN;
}

export const councilBiGrade0To10Schema = z
  .union([z.number(), z.string(), z.null()])
  .transform((val, ctx) => {
    const parsed = parsePtBrDecimal(val);
    if (parsed === null) return null;
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 10) {
      ctx.addIssue({
        code: "custom",
        message: "Nota do BI deve estar na escala decimal entre 0 e 10.",
      });
      return z.NEVER;
    }
    return parsed;
  });

export const councilBiTurmaItemSchema = z.object({
  turmaRaw: z.string().trim().min(1).max(160),
  codturma: z.string().trim().max(40).optional().nullable(),
  periodoAvaliacao: z.string().trim().max(40).optional().nullable(),
  equivalenciaSeriacao: z.string().trim().max(120).optional().nullable(),
  curso: z.string().trim().max(160).optional().nullable(),
  alunosMatriculados: z.number().int().min(0).max(5000).optional().nullable(),
  alunosAvaliados: z.number().int().min(0).max(5000).optional().nullable(),
});

export const councilBiAlunoTurmaItemSchema = z.object({
  cgm: z.string().trim().max(30).optional().nullable(),
  cgmkey: z.string().trim().max(40).optional().nullable(),
  nome: z.string().trim().max(200).optional().nullable(),
  codturma: z.string().trim().max(40).optional().nullable(),
  periodoava: z.string().trim().max(40).optional().nullable(),
  media1Tri: councilBiGrade0To10Schema.optional(),
  media2Tri: councilBiGrade0To10Schema.optional(),
  media3Tri: councilBiGrade0To10Schema.optional(),
  abaixoBasicoCount: z.number().int().min(0).max(500).optional().nullable(),
  basicoCount: z.number().int().min(0).max(500).optional().nullable(),
  adequadoCount: z.number().int().min(0).max(500).optional().nullable(),
  avancadoCount: z.number().int().min(0).max(500).optional().nullable(),
  qtdeNotasDadas: z.number().int().min(0).max(1000).optional().nullable(),
});

export const councilBiMapaNotaItemSchema = z.object({
  cgm: z.string().trim().max(30).optional().nullable(),
  cgmkey: z.string().trim().max(40).optional().nullable(),
  nome: z.string().trim().max(200).optional().nullable(),
  codturma: z.string().trim().max(40).optional().nullable(),
  disciplinaRaw: z.string().trim().min(1).max(160),
  disciplinaCode: z.string().trim().max(30).optional().nullable(),
  nota1Tri: councilBiGrade0To10Schema.optional(),
  nota2Tri: councilBiGrade0To10Schema.optional(),
  nota3Tri: councilBiGrade0To10Schema.optional(),
});

export const classCouncilBiSyncSchema = z
  .object({
    year: z.coerce.number().int().min(2020).max(2100).optional().default(2026),
    turmas: z.array(councilBiTurmaItemSchema).max(300).optional().default([]),
    alunosTurma: z.array(councilBiAlunoTurmaItemSchema).max(5000).optional().default([]),
    notasMapa: z.array(councilBiMapaNotaItemSchema).max(50000).optional().default([]),
  })
  .refine(
    (d) => d.turmas.length > 0 || d.alunosTurma.length > 0 || d.notasMapa.length > 0,
    {
      message: "Nenhum dado do BI Aprendizagem foi enviado para sincronização.",
    }
  );
