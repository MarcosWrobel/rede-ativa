import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as createAtaDraft } from "@/app/api/atas/route";
import { POST as finalizeAta } from "@/app/api/atas/[id]/finalize/route";
import { PATCH as updateAtaDraft } from "@/app/api/atas/[id]/route";
import { POST as generateSignToken } from "@/app/api/atas/[id]/sign-token/route";
import { generateLocalAtaMinuta } from "@/lib/nreAtaFormatter";
import { createAiPseudonymizer } from "@/lib/aiPseudonymizer";
import { generateAtaPdfA1b } from "@/lib/ataPdfArchive";
import { computeMinuteHash, verifyMinuteIntegrity } from "@/lib/ataCrypto";

import { hashPin } from "@/lib/signingPin";

const hoisted = vi.hoisted(() => {
  const state = {
    session: {
      user: {
        id: "usr_pedagoga_1",
        name: "Equipe Pedagógica",
        email: "pedagoga@escola.pr.gov.br",
        role: "PEDAGOGA",
        schoolId: "school-1",
      },
    } as any,
    db: {
      schools: [
        { id: "school-1", inepCode: "12345678", name: "Colégio Estadual Modelo" },
        { id: "school-2", inepCode: "87654321", name: "Outro Colégio Estadual" },
      ],
      students: [
        { id: "stud-esc-1", name: "Aluno da Escola 1", schoolId: "school-1", classGroup: { name: "9º Ano A" } },
        { id: "stud-esc-2", name: "Aluno de Outra Escola", schoolId: "school-2", classGroup: { name: "8º Ano B" } },
      ],
      users: [
        {
          id: "usr_pedagoga_1",
          name: "Equipe Pedagógica",
          email: "pedagoga@escola.pr.gov.br",
          role: "PEDAGOGA",
          schoolId: "school-1",
          signingPinHash: null as string | null,
          pinAttempts: 0,
        },
      ],
      minutes: [] as any[],
    },
  };
  return { state };
});

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => hoisted.state.session),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => undefined,
  })),
  headers: vi.fn(async () => new Headers({ host: "localhost:3000", "x-forwarded-for": "127.0.0.1" })),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async () => {}),
  extractClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/currentSchool", () => ({
  getCurrentSchool: vi.fn(async () => hoisted.state.db.schools[0]),
  ensureDefaultSchool: vi.fn(async () => hoisted.state.db.schools[0]),
}));

vi.mock("@/lib/tenantGuard", () => ({
  assertTenantOwnership: vi.fn(() => true),
}));

vi.mock("@/lib/prisma", () => {
  const db = hoisted.state.db;

  const mockPrisma: any = {
    school: {
      findUnique: vi.fn(async ({ where }: any) => {
        return db.schools.find((s) => s.id === where.id || s.inepCode === where.inepCode) || null;
      }),
      findFirst: vi.fn(async () => db.schools[0]),
    },
    student: {
      findMany: vi.fn(async ({ where }: any) => {
        const ids = where?.id?.in || [];
        const schoolId = where?.schoolId;
        return db.students.filter((s) => ids.includes(s.id) && (!schoolId || s.schoolId === schoolId));
      }),
    },
    user: {
      findUnique: vi.fn(async ({ where }: any) => {
        return db.users.find((u) => u.id === where.id || u.email === where.email) || null;
      }),
    },
    pedagogicalMinuteStudent: {
      deleteMany: vi.fn(async ({ where }: any) => {
        const m = db.minutes.find((item) => item.id === where.minuteId);
        if (m) m.students = [];
        return { count: 1 };
      }),
      createMany: vi.fn(async ({ data }: any) => {
        data.forEach((d: any) => {
          const m = db.minutes.find((item) => item.id === d.minuteId);
          if (m) {
            if (!m.students) m.students = [];
            m.students.push({
              id: `ms-${Math.random()}`,
              studentId: d.studentId,
              studentNameSnapshot: d.studentNameSnapshot,
              classNameSnapshot: d.classNameSnapshot,
              cgmSnapshot: d.cgmSnapshot,
            });
          }
        });
        return { count: data.length };
      }),
    },
    pedagogicalMinuteParticipant: {
      count: vi.fn(async ({ where }: any) => {
        const m = db.minutes.find((item) => item.id === where.minuteId);
        return m?.participants?.length || 0;
      }),
      findMany: vi.fn(async ({ where }: any) => {
        const m = db.minutes.find((item) => item.id === where.minuteId);
        return m?.participants || [];
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        for (const m of db.minutes) {
          if (!where?.minuteId || m.id === where.minuteId) {
            const p = m.participants?.find((part: any) => !where?.id || part.id === where.id);
            if (p) return p;
          }
        }
        return null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        for (const m of db.minutes) {
          const p = m.participants?.find((part: any) => part.id === where.id);
          if (p) {
            Object.assign(p, data);
            return p;
          }
        }
        return { id: where.id, ...data };
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const m = db.minutes.find((item) => item.id === where.minuteId);
        if (m) m.participants = [];
        return { count: 1 };
      }),
      createMany: vi.fn(async ({ data }: any) => {
        data.forEach((d: any) => {
          const m = db.minutes.find((item) => item.id === d.minuteId);
          if (m) {
            if (!m.participants) m.participants = [];
            m.participants.push({ ...d, id: d.id || `mp-${Math.random()}` });
          }
        });
        return { count: data.length };
      }),
    },
    pedagogicalActionItem: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
      createMany: vi.fn(async ({ data }: any) => ({ count: data.length })),
    },
    pedagogicalMinute: {
      findFirst: vi.fn(async ({ where }: any) => {
        const filtered = db.minutes.filter((m) => m.schoolId === where?.schoolId);
        return filtered[filtered.length - 1] || null;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        return db.minutes.find((m) => m.id === where.id) || null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const newMinute = {
          id: `minute-${Date.now()}`,
          schoolId: data.schoolId,
          year: data.year,
          status: data.status,
          category: data.category,
          isConfidential: data.isConfidential,
          attendedAt: data.attendedAt,
          subject: data.subject,
          rawNotes: data.rawNotes,
          summary: data.summary,
          agreementsSummary: data.agreementsSummary,
          authorId: data.authorId,
          authorName: data.authorName,
          authorEmail: data.authorEmail,
          authorRole: data.authorRole,
          authorIp: data.authorIp,
          students: (data.students?.create || []).map((s: any) => ({
            id: `ms-${Math.random()}`,
            ...s,
          })),
          participants: (data.participants?.create || []).map((p: any) => ({
            id: `mp-${Math.random()}`,
            ...p,
          })),
          actionItems: [],
        };
        db.minutes.push(newMinute);
        return newMinute;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const idx = db.minutes.findIndex((m) => m.id === where.id);
        if (idx !== -1) {
          db.minutes[idx] = { ...db.minutes[idx], ...data };
          return db.minutes[idx];
        }
        return null;
      }),
    },
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(async (cb: any) => {
      return cb(mockPrisma);
    }),
  };

  return { prisma: mockPrisma };
});

describe("Atas de Orientação Docente / Equipe Escolar (ORIENTACAO_DOCENTE)", () => {
  beforeEach(() => {
    hoisted.state.db.minutes = [];
  });

  it("1. cria rascunho de Ata de Orientação Docente com studentIds: [] e participante role: 'PROFESSOR'", async () => {
    const payload = {
      category: "ORIENTACAO_DOCENTE",
      subject: "Orientação Pedagógica sobre Cumprimento do RCO e Prazos",
      summary: "Alinhamento com o docente da disciplina de Língua Portuguesa sobre registros avaliativos.",
      studentIds: [],
      participants: [
        {
          role: "PROFESSOR",
          name: "Carlos Alberto de Souza",
          kinship: "Docente — Língua Portuguesa",
          expectedEmail: "carlos.souza@escola.pr.gov.br",
        },
      ],
    };

    const req = new Request("http://localhost:3000/api/atas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const res = await createAtaDraft(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.minute).toBeDefined();
    expect(body.minute.category).toBe("ORIENTACAO_DOCENTE");
    expect(body.minute.students).toHaveLength(0);
    expect(body.minute.participants).toHaveLength(1);
    expect(body.minute.participants[0].role).toBe("PROFESSOR");
    expect(body.minute.participants[0].name).toBe("Carlos Alberto de Souza");
  });

  it("2. rejeita (400 Bad Request) tentativa de criar ata sem alunos E sem participantes", async () => {
    const payloadOrfao = {
      category: "ORIENTACAO_DOCENTE",
      subject: "Ata sem participantes nem alunos",
      studentIds: [],
      participants: [],
    };

    const req = new Request("http://localhost:3000/api/atas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadOrfao),
    });

    const res = await createAtaDraft(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Vincule pelo menos um estudante ou adicione ao menos um docente");
  });

  it("3. mantém a trava anti-IDOR quando studentIds contém estudante pertencente a outra escola", async () => {
    const payloadInvasivo = {
      category: "ACOMPANHAMENTO_PEDAGOGICO",
      subject: "Tentativa de vincular aluno de outro colégio",
      studentIds: ["stud-esc-2"], // school-2 enquanto a sessão está em school-1
      participants: [{ role: "RESPONSAVEL", name: "Pai do Aluno" }],
    };

    const req = new Request("http://localhost:3000/api/atas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadInvasivo),
    });

    const res = await createAtaDraft(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("não foram encontrados nesta instituição escolar");
  });

  it("4. lavra oficialmente com hash SHA-256 uma Ata de Orientação Docente sem estudantes", async () => {
    // Cadastra PIN de Fé Pública para a servidora
    hoisted.state.db.users[0].signingPinHash = await hashPin("8391");
    hoisted.state.db.users[0].pinAttempts = 0;

    // 1. Cria o rascunho com 1 participante docente
    const draftMinute = {
      id: "minute-docente-1",
      schoolId: "school-1",
      year: 2026,
      status: "DRAFT",
      category: "ORIENTACAO_DOCENTE",
      attendedAt: new Date(),
      subject: "Alinhamento Pedagógico e Plano de Aula",
      summary: "Aos cinco dias do mês de novembro, reuniu-se a Equipe Pedagógica com o docente...",
      agreementsSummary: "Docente comprometeu-se a entregar os planos de trabalho até sexta-feira.",
      authorEmail: "pedagoga@escola.pr.gov.br",
      authorName: "Pedagoga Titular",
      authorRole: "PEDAGOGA",
      students: [],
      participants: [
        {
          id: "part-1",
          role: "PROFESSOR",
          name: "Professora Mariana Lima",
          expectedEmail: "mariana.lima@escola.pr.gov.br",
          signatureMode: "SCREEN_CANVAS",
          signatureData: "data:image/png;base64,assinatura_docente",
        },
      ],
      actionItems: [],
    };
    hoisted.state.db.minutes.push(draftMinute);

    const reqFinalize = new Request("http://localhost:3000/api/atas/minute-docente-1/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signingPin: "8391",
        summary: draftMinute.summary,
        actionItems: [
          {
            description: "Registrar notas pendentes do 3º trimestre no RCO",
            responsible: "DOCENTE",
            dueDate: "2026-11-20",
          },
        ],
      }),
    });

    const resFinalize = await finalizeAta(reqFinalize, { params: Promise.resolve({ id: "minute-docente-1" }) });
    expect(resFinalize.status).toBe(200);

    const finalMinute = hoisted.state.db.minutes.find((m) => m.id === "minute-docente-1");
    expect(finalMinute.status).toBe("FINALIZED");
    expect(finalMinute.ataNumber).toBe(1);
    expect(finalMinute.contentHash).toBeDefined();
    expect(finalMinute.contentHash).toHaveLength(64);
  });

  it("5. formata minuta local NRE para ORIENTACAO_DOCENTE sem alunos e sem citar responsáveis familiares", () => {
    const res = generateLocalAtaMinuta({
      rawNotes: "Professor esteve presente para alinhar o lançamento de frequência no RCO e cronograma de provas",
      category: "ORIENTACAO_DOCENTE",
      studentNames: [],
      guardianNames: [],
      teacherNames: ["Carlos Alberto de Souza"],
      attendedAt: "2026-11-05T10:00:00.000Z",
    });

    expect(res.formalSubject).toBe("Orientação Técnico-Pedagógica — Docente");
    expect(res.formalSummary).toContain("Carlos Alberto de Souza");
    expect(res.formalSummary).toContain("orientação técnico-pedagógica");
    expect(res.formalSummary).not.toContain("responsável legal");
    expect(res.formalSummary).not.toContain("o(a) estudante");
    expect(res.agreementsSummary).toContain("docente");
    expect(res.actionItems[0].responsible).toBe("DOCENTE");
  });

  it("6. gera PDF/A-1b oficial com bloco 'Docente(s) / Servidor(es) Envolvido(s)' para ata docente sem alunos", async () => {
    const minuteDocente = {
      id: "minute-pdfa-docente",
      schoolId: "school-1",
      year: 2026,
      ataNumber: 15,
      status: "FINALIZED",
      category: "ORIENTACAO_DOCENTE",
      attendedAt: new Date().toISOString(),
      subject: "Orientação Docente de Planejamento Trimestral",
      summary: "Reunião pedagógica realizada com o corpo docente para alinhamento pedagógico e prazos de RCO.",
      agreementsSummary: "Docentes acordaram cumprir o cronograma de fechamento.",
      authorName: "Equipe Pedagógica",
      authorRole: "PEDAGOGA",
      contentHash: "a".repeat(64),
      verificationCode: "DOC-2026-12345",
      school: {
        name: "Colégio Estadual Leopoldina B. Pedroso",
        inepCode: "41042730",
        city: "Curitiba",
        state: "PR",
        nre: "Área Metropolitana Norte",
      },
      students: [],
      participants: [
        {
          id: "p-prof-1",
          name: "Prof. Marcos Vinicius Wrobel",
          role: "PROFESSOR",
          kinship: "Docente — Física",
          signatureMode: "SCREEN_CANVAS",
          signatureData: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          signedAt: new Date().toISOString(),
        },
      ],
      actionItems: [],
      addendums: [],
    };

    const pdfResult = await generateAtaPdfA1b(minuteDocente);
    expect(pdfResult.pdfBytes).toBeDefined();
    expect(pdfResult.pdfBytes.length).toBeGreaterThan(1000);
    expect(pdfResult.sha256).toHaveLength(64);
  });

  it("7. calcula e valida hash canônico SHA-256 com determinismo para ata com students: []", () => {
    const payload = {
      schoolId: "school-1",
      year: 2026,
      ataNumber: 7,
      attendedAt: "2026-11-05T14:00:00.000Z",
      category: "ORIENTACAO_DOCENTE",
      subject: "Orientação sobre Recomposição da Aprendizagem",
      summary: "Reunião de alinhamento com a equipe docente.",
      authorEmail: "pedagoga@escola.pr.gov.br",
      students: [],
      participants: [
        {
          role: "PROFESSOR",
          name: "Professor Bruno Silva",
          signatureMode: "GOOGLE_OIDC",
          verifiedEmail: "bruno.silva@escola.pr.gov.br",
        },
      ],
      actionItems: [
        {
          description: "Entregar planejamento de recomposição",
          responsible: "DOCENTE",
        },
      ],
    };

    const hash1 = computeMinuteHash(payload);
    const hash2 = computeMinuteHash(payload);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);

    const check1 = verifyMinuteIntegrity(payload, hash1);
    expect(check1.isValid).toBe(true);

    const checkTampered = verifyMinuteIntegrity(
      { ...payload, summary: payload.summary + " alterado" },
      hash1
    );
    expect(checkTampered.isValid).toBe(false);
  });

  it("8. mascara e desmascara nomes de docentes no aiPseudonymizer com prevenção contra colisão de nomes compostos", () => {
    const teachers = [
      "Ana Silva",
      "Ana Silva Sauro",
      "Prof. Fernando de Nóbrega",
    ];

    const pseudonymizer = createAiPseudonymizer([], [], teachers);
    expect(pseudonymizer.maskedTeacherNames).toHaveLength(3);
    expect(pseudonymizer.maskedTeacherNames[0]).toBe("[DOCENTE_1]");
    expect(pseudonymizer.maskedTeacherNames[1]).toBe("[DOCENTE_2]");
    expect(pseudonymizer.maskedTeacherNames[2]).toBe("[DOCENTE_3]");

    const rawText = "Reunião com Ana Silva Sauro e com a docente Ana Silva, além do Prof. Fernando de Nóbrega sobre o RCO.";
    const masked = pseudonymizer.maskText(rawText);

    // Ana Silva Sauro deve ser substituído antes de Ana Silva para não corromper o nome composto!
    expect(masked).toContain("[DOCENTE_2]");
    expect(masked).toContain("[DOCENTE_1]");
    expect(masked).toContain("[DOCENTE_3]");
    expect(masked).not.toContain("Ana Silva");
    expect(masked).not.toContain("Fernando de Nóbrega");

    const unmasked = pseudonymizer.unmaskText(masked);
    expect(unmasked).toBe(rawText);
  });

  it("9. permite gerar token de assinatura móvel (QR Code) para docente em ata sem estudantes vinculados", async () => {
    // 1. Cria rascunho de ata de orientação docente com 0 estudantes e 1 docente
    const createReq = new Request("http://localhost:3000/api/atas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: "ORIENTACAO_DOCENTE",
        subject: "Orientação sobre Lançamento de Notas e Frequência",
        summary: "Docente foi orientado formalmente quanto aos prazos do RCO.",
        studentIds: [],
        participants: [
          {
            role: "PROFESSOR",
            name: "Professor José Luiz Mercer",
            documentType: "RG",
            documentNumber: "1055012235",
            expectedEmail: "jose.mercer@escola.pr.gov.br",
          },
        ],
      }),
    });

    const createRes = await createAtaDraft(createReq);
    expect(createRes.status).toBe(201);
    const createBody = await createRes.json();
    const minuteId = createBody.minute.id;
    const teacherPart = createBody.minute.participants[0];
    expect(teacherPart.id).toBeDefined();

    // 2. Dispara geração de token de assinatura remota (QR Code)
    const signTokenReq = new Request(`http://localhost:3000/api/atas/${minuteId}/sign-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantId: teacherPart.id,
        expiresInMinutes: 20,
      }),
    });

    const signTokenRes = await generateSignToken(signTokenReq, {
      params: Promise.resolve({ id: minuteId }),
    });

    expect(signTokenRes.status).toBe(200);
    const signTokenBody = await signTokenRes.json();
    expect(signTokenBody.success).toBe(true);
    expect(signTokenBody.token).toBeDefined();
    expect(signTokenBody.signUrl).toContain(`/assinar/ata/${signTokenBody.token}`);
    expect(signTokenBody.participantName).toBe("Professor José Luiz Mercer");
  });
});
