import { describe, it, expect } from "vitest";
import {
  determineShift,
  getGreeting,
  getShiftLabel,
  formatMessage,
  type StudentContext,
} from "../messageFormatter";

const baseStudent: StudentContext = {
  id: "stu-1",
  name: "ANA CLARA DA SILVA",
  guardianName: "Maria da Silva",
  classGroup: {
    id: "cg-1",
    name: "8º Ano A",
    segment: "FUNDAMENTAL",
    shift: "MANHA",
  },
};

describe("messageFormatter", () => {
  describe("determineShift", () => {
    it("respeita overrideShift explícito da pedagoga", () => {
      expect(determineShift(baseStudent, "NOITE", 9)).toBe("NOITE");
    });

    it("detecta segmento NOTURNO como turno NOITE", () => {
      const noturnoStudent: StudentContext = {
        ...baseStudent,
        classGroup: { name: "2ª Série A", segment: "NOTURNO", shift: "" },
      };
      expect(determineShift(noturnoStudent)).toBe("NOITE");
    });

    it("detecta turno registrado na turma (MANHA / TARDE)", () => {
      expect(determineShift(baseStudent)).toBe("MANHA");
      const tardeStudent: StudentContext = {
        ...baseStudent,
        classGroup: { name: "1º ADM", segment: "MEDIO", shift: "TARDE" },
      };
      expect(determineShift(tardeStudent)).toBe("TARDE");
    });

    it("usa hora local como fallback quando turma não especifica turno", () => {
      const genericStudent: StudentContext = {
        ...baseStudent,
        classGroup: { name: "6º Ano B", segment: "FUNDAMENTAL", shift: "" },
      };
      expect(determineShift(genericStudent, undefined, 8)).toBe("MANHA");
      expect(determineShift(genericStudent, undefined, 14)).toBe("TARDE");
      expect(determineShift(genericStudent, undefined, 20)).toBe("NOITE");
    });
  });

  describe("getGreeting & getShiftLabel", () => {
    it("retorna saudações e rótulos corretos por turno", () => {
      expect(getGreeting("MANHA")).toBe("Bom dia!");
      expect(getGreeting("TARDE")).toBe("Boa tarde!");
      expect(getGreeting("NOITE")).toBe("Boa noite!");
      expect(getShiftLabel("MANHA")).toContain("Matutino");
    });
  });

  describe("formatMessage", () => {
    it("interpola tags de aluno, turma, responsável, frequência e SERP", () => {
      const msg = formatMessage(
        "{saudacao} {responsavel}, informamos que {aluno} ({turma}) encontra-se com frequência de {frequencia} ({situacao_frequencia}).",
        "Protocolo: {protocolo_serp}. Atenciosamente, {pedagoga}.",
        {
          student: baseStudent,
          pedagogaName: "Solange",
          attendance: {
            percent: 68.5,
            serpProtocol: "2026991",
          },
        }
      );

      expect(msg).toContain("Bom dia! Maria da Silva");
      expect(msg).toContain("ANA CLARA DA SILVA (8º Ano A)");
      expect(msg).toContain("68,5%");
      expect(msg).toContain("abaixo do mínimo legal de 75%");
      expect(msg).toContain("Ficha SERP nº 2026991");
      expect(msg).toContain("Atenciosamente, Solange.");
      // Como {aluno} já apareceu no corpo, não deve duplicar o bloco automático "*Aluno(a):*"
      expect(msg).not.toContain("*Aluno(a):*");
    });

    it("insere bloco estruturado *Aluno(a):* e *Turma:* quando modelo não usa {aluno}", () => {
      const msg = formatMessage(
        "{saudacao} Comunicamos ausência escolar na data de hoje.",
        "Solicitamos justificativa na secretaria.",
        {
          student: baseStudent,
          overrideShift: "TARDE",
        }
      );

      expect(msg).toContain("Boa tarde! Comunicamos ausência escolar");
      expect(msg).toContain("*Aluno(a):* ANA CLARA DA SILVA\n*Turma:* 8º Ano A");
      expect(msg).toContain("Solicitamos justificativa na secretaria.");
    });

    it("substitui saudações fixas legadas (ex: 'Boa tarde,') pelo turno efetivo sem duplicar pontuação", () => {
      const msgWithComma = formatMessage(
        "Boa tarde, senhores pais de {aluno}.",
        "",
        {
          student: baseStudent,
          overrideShift: "NOITE",
        }
      );
      expect(msgWithComma).toBe("Boa noite, senhores pais de ANA CLARA DA SILVA.");

      const msgWithBang = formatMessage(
        "Boa noite!\nComunicado para {aluno}.",
        "",
        {
          student: baseStudent,
          overrideShift: "MANHA",
        }
      );
      expect(msgWithBang).toBe("Bom dia!\nComunicado para ANA CLARA DA SILVA.");
    });
  });
});
