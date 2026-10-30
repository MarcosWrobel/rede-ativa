import { describe, it, expect } from "vitest";
import {
  computeMinuteHash,
  computeAddendumHash,
  generateVerificationCode,
  maskName,
  maskDocument,
  anonymizeOtherMinorsInText,
} from "../ataCrypto";

describe("ataCrypto - Integridade Criptográfica e Conformidade LGPD/ECA", () => {
  const samplePayload = {
    schoolId: "school-123",
    year: 2026,
    ataNumber: 42,
    attendedAt: "2026-10-30T10:00:00.000Z",
    category: "CONVIVENCIA_INDISCIPLINA",
    subject: "Mediação de conflito em sala de aula",
    summary: "Reunião pedagógica realizada com os responsáveis para alinhamento de conduta.",
    agreementsSummary: "Acompanhamento diário com a equipe pedagógica.",
    authorEmail: "pedagoga@escola.pr.gov.br",
    students: [
      { studentId: "stud-1", name: "Lucas Ferreira", className: "9º Ano A", cgm: "12345" },
      { studentId: "stud-2", name: "Gabriel Souza", className: "9º Ano A", cgm: "67890" },
    ],
    participants: [
      { role: "RESPONSAVEL", name: "Carla Ferreira", documentNumber: "123.456.789-00", signatureMode: "SCREEN_CANVAS", signatureData: "data:image/png;base64,xxx" },
      { role: "RESPONSAVEL", name: "Marcos Souza", documentNumber: "987.654.321-99", signatureMode: "REFUSED", refusalReason: "Não concorda com a suspensão" },
    ],
    actionItems: [
      { description: "Trazer atestado médico", responsible: "FAMILIA", dueDate: "2026-11-05" },
    ],
  };

  it("gera hash SHA-256 canônico determinístico independente da ordem dos arrays", () => {
    const hash1 = computeMinuteHash(samplePayload);
    expect(hash1).toHaveLength(64);

    // Invertendo ordem de alunos e participantes para testar ordenação canônica
    const invertedPayload = {
      ...samplePayload,
      students: [samplePayload.students[1], samplePayload.students[0]],
      participants: [samplePayload.participants[1], samplePayload.participants[0]],
    };
    const hash2 = computeMinuteHash(invertedPayload);
    expect(hash1).toBe(hash2);
  });

  it("detecta alteração indevida de qualquer caractere no texto ou combinados", () => {
    const hashOriginal = computeMinuteHash(samplePayload);
    const alteredPayload = {
      ...samplePayload,
      summary: samplePayload.summary + " alteração oculta",
    };
    const hashAltered = computeMinuteHash(alteredPayload);
    expect(hashOriginal).not.toBe(hashAltered);
  });

  it("calcula hash-chaining consistente para Termo de Aditamento", () => {
    const prevHash = computeMinuteHash(samplePayload);
    const addendumHash = computeAddendumHash(
      prevHash,
      "Em tempo: o responsável compareceu às 11h trazendo justificativa adicional.",
      "pedagoga@escola.pr.gov.br",
      "2026-10-30T14:30:00.000Z"
    );
    expect(addendumHash).toHaveLength(64);
    expect(addendumHash).not.toBe(prevHash);
  });

  it("gera código de verificação curto não enumerável no formato correto", () => {
    const code = generateVerificationCode();
    expect(code).toMatch(/^ATA-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
  });

  it("mascara nomes e documentos para página de validação pública cega", () => {
    expect(maskName("Maria Aparecida da Silva")).toBe("M**** A******** d* S****");
    expect(maskDocument("123.456.789-00")).toBe("12**********00");
  });

  it("anonimiza outros menores em ata conjunta no Dossiê individual (ECA/LGPD)", () => {
    const text = "O estudante Lucas Ferreira se envolveu em atrito com Gabriel Souza durante o intervalo. Gabriel admitiu a conversa.";
    const targetStudentId = "stud-1"; // Queremos o dossiê de Lucas Ferreira
    const linkedStudents = [
      { id: "stud-1", name: "Lucas Ferreira" },
      { id: "stud-2", name: "Gabriel Souza" },
    ];

    const anonymized = anonymizeOtherMinorsInText(text, targetStudentId, linkedStudents);
    expect(anonymized).toContain("Lucas Ferreira");
    expect(anonymized).not.toContain("Gabriel Souza");
    expect(anonymized).toContain("G. S. (outro estudante)");
  });
});
