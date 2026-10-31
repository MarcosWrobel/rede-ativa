import { describe, expect, it } from "vitest";
import {
  buildWaMeUrl,
  classifyGuardianReplyHeuristic,
  dispatchWhatsAppMessage,
  evaluateQueueCandidate,
} from "../whatsappProvider";
import {
  aiClassifyReplySchema,
  messageDeliveryStatusUpdateSchema,
  messageReplySchema,
} from "../schemas";

describe("Fase 4 — Fluxo wa.me, Fila Assistida por Turma e Classificação de Retorno", () => {
  it("constrói URL wa.me normalizada com código DDI 55 e opera em modo WA_ME por padrão", async () => {
    const url = buildWaMeUrl("(42) 99988-7766", "Bom dia! Teste escolar");
    expect(url).toBe("https://wa.me/5542999887766?text=Bom%20dia!%20Teste%20escolar");

    const dispatch = await dispatchWhatsAppMessage({
      phoneDigits: "42999887766",
      messageText: "Mensagem institucional",
    });
    expect(dispatch.mode).toBe("WA_ME");
    expect(dispatch.initialStatus).toBe("LINK_OPENED");
    expect(dispatch.whatsappUrl).toContain("https://wa.me/5542999887766");
  });

  it("evaluateQueueCandidate desmarca alunos com atestado médico vigente e alterna para contato válido se o principal não tiver WhatsApp", () => {
    const refDate = new Date("2026-10-30T10:00:00-03:00");

    // 1. Com atestado médico vigente
    const withCert = evaluateQueueCandidate(
      {
        phone: "42988112233",
        guardianName: "Maria Silva",
        justifications: [
          {
            id: "j1",
            type: "ATESTADO_MEDICO",
            startDate: "2026-10-28T00:00:00.000Z",
            endDate: "2026-10-31T23:59:59.000Z",
          },
        ],
      },
      refDate
    );
    expect(withCert.eligibleByDefault).toBe(false);
    expect(withCert.skipReason).toBe("ATESTADO_VIGENTE");

    // 2. Principal sem WhatsApp, mas Pai com WhatsApp válido (fallback automático!)
    const withFallback = evaluateQueueCandidate(
      {
        phone: "42988000000",
        guardianName: "Mãe Sem Zap",
        contacts: [
          { name: "Mãe Sem Zap", phone: "42988000000", whatsappValid: false },
          { name: "Carlos (Pai)", phone: "42999112233", whatsappValid: true },
        ],
      },
      refDate
    );
    expect(withFallback.eligibleByDefault).toBe(true);
    expect(withFallback.usedFallbackContact).toBe(true);
    expect(withFallback.resolvedPhone).toBe("42999112233");
    expect(withFallback.resolvedGuardianName).toBe("Carlos (Pai)");

    // 3. Todos os contatos sem WhatsApp
    const noValid = evaluateQueueCandidate(
      {
        phone: "42988000000",
        contacts: [{ name: "Mãe", phone: "42988000000", whatsappValid: false }],
      },
      refDate
    );
    expect(noValid.eligibleByDefault).toBe(false);
    expect(noValid.skipReason).toBe("SEM_WHATSAPP");

    // 4. Já acionado hoje com sucesso -> pula por padrão; se tentativa anterior falhou por falta de WhatsApp, não bloqueia
    const sentToday = evaluateQueueCandidate(
      {
        phone: "42999112233",
        messageLogs: [{ sentAt: "2026-10-30T08:30:00-03:00", deliveryStatus: "SENT" }],
      },
      refDate
    );
    expect(sentToday.eligibleByDefault).toBe(false);
    expect(sentToday.skipReason).toBe("JA_ACIONADO_HOJE");
  });

  it("classifica e formaliza justificativas informais dos pais nas categorias corretas", () => {
    const saude = classifyGuardianReplyHeuristic(
      "Oi professora, levei ela no postinho hoje cedo porque estava com muita febre, segunda mando atestado"
    );
    expect(saude.category).toBe("SAUDE");
    expect(saude.requiresMedicalCertificate).toBe(true);
    expect(saude.formalSummary).toContain("Responsável informou via WhatsApp");

    const transp = classifyGuardianReplyHeuristic(
      "Bom dia, o ônibus da linha rural quebrou por causa da chuva na estrada"
    );
    expect(transp.category).toBe("TRANSPORTE");

    const vuln = classifyGuardianReplyHeuristic(
      "Não sei mais o que fazer, ele trancou o quarto e disse que não quer ir mais pra escola"
    );
    expect(vuln.category).toBe("VULNERABILIDADE");
  });

  it("valida schemas Zod da Fase 4 para status de entrega e classificação de retorno", () => {
    expect(
      messageDeliveryStatusUpdateSchema.safeParse({
        logId: "cm123",
        deliveryStatus: "FAILED_NO_WHATSAPP",
      }).success
    ).toBe(true);

    expect(
      messageReplySchema.safeParse({
        logId: "cm123",
        guardianReplied: true,
        replyCategory: "SAUDE",
        replyNotes: "Apresentará atestado médico.",
      }).success
    ).toBe(true);

    expect(aiClassifyReplySchema.safeParse({ rawReply: "oi" }).success).toBe(false);
  });

  it("desmarca alunos do programa de intercâmbio Ganhando Mundo na Fila da Busca Ativa", () => {
    const exchangeCandidate = evaluateQueueCandidate({
      phone: "42999554433",
      guardianName: "Carlos Pereira",
      isExchangeStudent: true,
    });
    expect(exchangeCandidate.eligibleByDefault).toBe(false);
    expect(exchangeCandidate.skipReason).toBe("INTERCAMBIO_GANHANDO_MUNDO");
  });
});
