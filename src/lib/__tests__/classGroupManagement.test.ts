import { describe, it, expect } from "vitest";
import { classGroupCreateSchema } from "@/lib/schemas";
import { parseSereRawFiles } from "@/lib/sereParser";

describe("Gestão de Turmas (ClassGroup) e Importação de Testes", () => {
  describe("classGroupCreateSchema", () => {
    it("valida payload completo de criação de turma com sucesso", () => {
      const valid = {
        name: "6º Ano A",
        segment: "FUNDAMENTAL",
        shift: "MANHA",
      };
      const res = classGroupCreateSchema.safeParse(valid);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.name).toBe("6º Ano A");
        expect(res.data.segment).toBe("FUNDAMENTAL");
        expect(res.data.shift).toBe("MANHA");
      }
    });

    it("aplica valores padrão para segment e shift quando omitidos", () => {
      const res = classGroupCreateSchema.safeParse({ name: "Turma de Robótica" });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.name).toBe("Turma de Robótica");
        expect(res.data.segment).toBe("FUNDAMENTAL");
        expect(res.data.shift).toBe("MANHA");
      }
    });

    it("rejeita nomes com menos de 2 caracteres ou apenas espaços", () => {
      const emptyRes = classGroupCreateSchema.safeParse({ name: "   " });
      expect(emptyRes.success).toBe(false);

      const singleChar = classGroupCreateSchema.safeParse({ name: "A" });
      expect(singleChar.success).toBe(false);
    });

    it("aceita todos os segmentos suportados no SaaS educacional", () => {
      const segments = ["FUNDAMENTAL", "MEDIO", "NOTURNO", "INFANTIL", "EJA"] as const;
      for (const seg of segments) {
        const res = classGroupCreateSchema.safeParse({ name: "Turma Teste", segment: seg });
        expect(res.success).toBe(true);
      }
    });

    it("aceita todos os turnos suportados", () => {
      const shifts = ["MANHA", "TARDE", "NOITE", "INTEGRAL"] as const;
      for (const shift of shifts) {
        const res = classGroupCreateSchema.safeParse({ name: "Turma Teste", shift });
        expect(res.success).toBe(true);
      }
    });

    it("rejeita segmento ou turno inválido", () => {
      const invalidSeg = classGroupCreateSchema.safeParse({
        name: "Turma X",
        segment: "FACULDADE",
      });
      expect(invalidSeg.success).toBe(false);

      const invalidShift = classGroupCreateSchema.safeParse({
        name: "Turma Y",
        shift: "MADRUGADA",
      });
      expect(invalidShift.success).toBe(false);
    });
  });

  describe("Planilha Modelo SERE para Testes Rápidos", () => {
    it("deve ser parseada com perfeição pelo parser SERE reconhecendo turmas e alunos", async () => {
      const sampleCsv = [
        "CGM;NOME DO ALUNO;TURMA;TURNO;TELEFONE;RESPONSAVEL;SITUACAO",
        "1018613001;ALICE MENEZES DA SILVA;6º Ano A;Manhã;41991234567;MARIA MENEZES;Matriculado",
        "1018613002;BRUNO CARVALHO DE OLIVEIRA;6º Ano A;Manhã;41992345678;JOAO CARVALHO;Matriculado",
        "1018613003;CLARA LUZ PEREIRA;1º Ano Médio B;Tarde;41993456789;FERNANDA LUZ;Matriculado",
        "1018613004;DANIEL SOUZA DOS SANTOS;1º Ano Médio B;Tarde;41994567890;ROBERTO SOUZA;Matriculado",
        "1018613005;EDUARDA LIMA ROCHA;EJA Fase I;Noite;41995678901;CARLA LIMA;Matriculado",
      ].join("\r\n");

      const buffer = new TextEncoder().encode(sampleCsv).buffer;
      const result = await parseSereRawFiles([
        {
          fileName: "modelo_importacao_sere_exemplo.csv",
          buffer,
        },
      ]);

      expect(result.format).toBe("TABULAR_CSV");
      expect(result.turmas.length).toBe(3);

      const turmaNames = result.turmas.map((t) => t.suggestedName).sort();
      expect(turmaNames).toContain("6º Ano A");
      expect(turmaNames).toContain("1º Ano Médio B");
      expect(turmaNames).toContain("EJA Fase I");

      const tFund = result.turmas.find((t) => t.suggestedName === "6º Ano A");
      expect(tFund).toBeDefined();
      expect(tFund?.students.length).toBe(2);
      expect(tFund?.students[0].cgm).toBe("1018613001");
      expect(tFund?.students[0].name).toBe("ALICE MENEZES DA SILVA");
      expect(tFund?.students[0].phone).toBe("41991234567");
      expect(tFund?.shift).toBe("MANHA");
      expect(tFund?.segment).toBe("FUNDAMENTAL");

      const tMedio = result.turmas.find((t) => t.suggestedName === "1º Ano Médio B");
      expect(tMedio).toBeDefined();
      expect(tMedio?.shift).toBe("TARDE");

      const tNoite = result.turmas.find((t) => t.suggestedName === "EJA Fase I");
      expect(tNoite).toBeDefined();
      expect(tNoite?.shift).toBe("NOITE");
      expect(tNoite?.segment).toBe("NOTURNO");
    });
  });
});
