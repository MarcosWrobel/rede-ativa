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

export const sereBatchImportSchema = z.object({
  turmas: z
    .array(
      z.object({
        tempId: z.string().trim().min(1),
        name: z.string().trim().min(1, "Nome da turma não pode ser vazio"),
        segment: z.enum(["FUNDAMENTAL", "MEDIO", "NOTURNO"]),
        shift: z.enum(["MANHA", "TARDE", "NOITE"]),
      })
    )
    .min(1, "Selecione ao menos uma turma para importar."),
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
    .min(1, "Nenhum aluno elegível para importação nas turmas selecionadas."),
  transferredStudents: z
    .array(
      z.object({
        cgm: z.string().trim().optional().nullable(),
        name: z.string().trim().min(2),
      })
    )
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
  "LINK_OPENED",
  "SENT",
  "DELIVERED",
  "READ",
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
  studentId: z.string().trim().min(1, "Aluno é obrigatório"),
  templateId: z.string().optional().nullable(),
  reasonTitle: z.string().trim().min(1, "Motivo é obrigatório"),
  messageContent: z.string().trim().min(2, "Conteúdo da mensagem é obrigatório"),
  customPhone: z.string().optional().nullable(),
  initialDeliveryStatus: deliveryStatusEnum.optional(),
});

export const messageDeliveryStatusUpdateSchema = z.object({
  logId: z.string().trim().min(1, "ID do registro é obrigatório"),
  deliveryStatus: deliveryStatusEnum,
});

export const messageReplySchema = z.object({
  logId: z.string().trim().min(1, "ID do registro é obrigatório"),
  guardianReplied: z.boolean(),
  replyNotes: z.string().optional().nullable(),
  replyCategory: replyCategoryEnum.optional().nullable(),
});

export const aiClassifyReplySchema = z.object({
  rawReply: z
    .string()
    .trim()
    .min(3, "Cole ou digite ao menos uma frase informada pelo responsável para classificar."),
  studentName: z.string().trim().optional().nullable(),
  reasonTitle: z.string().trim().optional().nullable(),
});

export const frequenciaSyncItemSchema = z.object({
  cgm: z.union([z.string(), z.number()]).optional().nullable(),
  nome: z.string().optional().nullable(),
  turma: z.string().optional().nullable(),
  mediaGeral: z.union([z.string(), z.number()]).optional().nullable(),
  semanaAtual: z.union([z.string(), z.number()]).optional().nullable(),
  semanaAnterior: z.union([z.string(), z.number()]).optional().nullable(),
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

export const userCreateSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Formato de e-mail inválido")
    .refine((e) => e.endsWith("@escola.pr.gov.br"), {
      message: "O e-mail deve pertencer ao domínio institucional @escola.pr.gov.br",
    }),
  name: z.string().trim().optional().default(""),
  role: z.enum(["PEDAGOGA", "ADMIN"]).optional().default("PEDAGOGA"),
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
