import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET as getParticipantCandidates } from "../atas/participant-candidates/route";
import { GET as getUsers } from "../users/route";
import { POST as postAta } from "../atas/route";
import { PATCH as patchAta } from "../atas/[id]/route";
import { executeMinuteFinalization } from "@/services/ataFinalizationService";

const state = {
  session: {
    user: {
      id: "user-pedagoga-a",
      name: "Pedagoga Escola A",
      email: "pedagoga@escola-a.pr.gov.br",
      role: "PEDAGOGA",
      schoolId: "escola-a",
      active: true,
      schools: [{ schoolId: "escola-a", role: "PEDAGOGA", active: true }],
      networks: [],
    },
  } as any,
  currentSchoolId: "escola-a",
  users: [] as any[],
  schools: [] as any[],
  students: [] as any[],
  minutes: [] as any[],
};

function selectFields<T extends Record<string, any>>(obj: T, select?: Record<string, any>) {
  if (!select) return { ...obj };
  const out: Record<string, any> = {};
  for (const [key, val] of Object.entries(select)) {
    if (!val) continue;
    if (typeof val === "object" && val.select) {
      if (Array.isArray(obj[key])) {
        out[key] = obj[key].map((item: any) => selectFields(item, val.select));
      } else if (obj[key] && typeof obj[key] === "object") {
        out[key] = selectFields(obj[key], val.select);
      } else {
        out[key] = obj[key] ?? null;
      }
    } else {
      out[key] = obj[key];
    }
  }
  return out;
}

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => state.session),
}));

vi.mock("@/lib/currentSchool", () => ({
  ensureDefaultSchool: vi.fn(async () => null),
  getCurrentSchool: vi.fn(async (schoolId?: string) => {
    const id = state.currentSchoolId || schoolId || "escola-a";
    return (
      state.schools.find((s) => s.id === id) || {
        id,
        name: `Escola ${id}`,
        inepCode: id === "escola-a" ? "41000001" : "41000002",
        edition: "INSTITUCIONAL_ESSENCIAL",
      }
    );
  }),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async () => {}),
  extractClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/minuteLock", () => ({
  acquireMinuteWriteLock: vi.fn(async () => {}),
  acquireSchoolYearSeqLock: vi.fn(async () => {}),
}));

vi.mock("@/lib/prisma", () => {
  const txMock: any = {
    $executeRaw: vi.fn(async () => 1),
    student: {
      findMany: vi.fn(async ({ where, select, include }: any) => {
        const list = state.students.filter((s) => {
          if (where?.id?.in && !where.id.in.includes(s.id)) return false;
          if (where?.schoolId && s.schoolId !== where.schoolId) return false;
          return true;
        });
        return list.map((s) => {
          if (select) return selectFields(s, select);
          if (include?.classGroup) return { ...s };
          return { ...s };
        });
      }),
    },
    pedagogicalMinute: {
      findUnique: vi.fn(async ({ where }: any) => {
        const found = state.minutes.find((m) => m.id === where.id);
        return found ? { ...found } : null;
      }),
      findFirst: vi.fn(async () => ({ ataNumber: 1 })),
      create: vi.fn(async ({ data }: any) => {
        const created = {
          id: "ata-new-1",
          schoolId: data.schoolId,
          year: data.year,
          status: data.status,
          category: data.category,
          isConfidential: data.isConfidential,
          attendedAt: data.attendedAt,
          subject: data.subject,
          summary: data.summary,
          students: data.students?.create || [],
          participants: (data.participants?.create || []).map((p: any, i: number) => ({
            id: `mp-new-${i + 1}`,
            ...p,
          })),
          actionItems: [],
        };
        state.minutes.push(created);
        return created;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const m = state.minutes.find((x) => x.id === where.id);
        if (!m) return null;
        Object.assign(m, data);
        return { ...m };
      }),
    },
    pedagogicalMinuteStudent: {
      deleteMany: vi.fn(async ({ where }: any) => {
        const m = state.minutes.find((x) => x.id === where.minuteId);
        if (m) m.students = [];
        return { count: 0 };
      }),
      createMany: vi.fn(async ({ data }: any) => {
        const first = data?.[0];
        const m = first ? state.minutes.find((x) => x.id === first.minuteId) : null;
        if (m) m.students = data;
        return { count: data?.length || 0 };
      }),
    },
    pedagogicalMinuteParticipant: {
      findMany: vi.fn(async ({ where }: any) => {
        const m = state.minutes.find((x) => x.id === where.minuteId);
        return m ? [...m.participants] : [];
      }),
      count: vi.fn(async ({ where }: any) => {
        const m = state.minutes.find((x) => x.id === where.minuteId);
        return m ? m.participants.length : 0;
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const m = state.minutes.find((x) => x.id === where.minuteId);
        if (m) m.participants = [];
        return { count: 0 };
      }),
      createMany: vi.fn(async ({ data }: any) => {
        const first = data?.[0];
        const m = first ? state.minutes.find((x) => x.id === first.minuteId) : null;
        if (m) {
          m.participants = data.map((p: any, i: number) => ({
            id: p.id || `mp-upd-${i + 1}`,
            ...p,
          }));
        }
        return { count: data?.length || 0 };
      }),
    },
    pedagogicalActionItem: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
  };

  return {
    prisma: {
      ...txMock,
      $transaction: vi.fn(async (fn: any) => fn(txMock)),
      user: {
        findUnique: vi.fn(async ({ where }: any) => {
          return state.users.find((u) => u.id === where.id) || null;
        }),
        findMany: vi.fn(async ({ where, orderBy, take, select }: any) => {
          let list = state.users.filter((u) => {
            if (where?.active === true && u.active !== true) return false;
            const targetSchool = where?.OR?.[0]?.schoolId;
            if (targetSchool) {
              const hasPrimary = u.schoolId === targetSchool;
              const hasActiveLink = (u.schools || []).some(
                (s: any) => s.schoolId === targetSchool && s.active === true
              );
              const hasInactiveLink = (u.schools || []).some(
                (s: any) => s.schoolId === targetSchool && s.active === false
              );
              if (hasInactiveLink) return false;
              if (!hasPrimary && !hasActiveLink) return false;
            }
            return true;
          });
          if (orderBy) {
            list = [...list].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
          }
          if (typeof take === "number") {
            list = list.slice(0, take);
          }
          return list.map((u) => selectFields(u, select));
        }),
      },
      school: {
        findUnique: vi.fn(async ({ where, select }: any) => {
          const found = state.schools.find((s) => s.id === where.id);
          return found ? selectFields(found, select) : null;
        }),
      },
    },
  };
});

beforeEach(() => {
  state.currentSchoolId = "escola-a";
  state.session = {
    user: {
      id: "user-pedagoga-a",
      name: "Pedagoga Escola A",
      email: "pedagoga@escola-a.pr.gov.br",
      role: "PEDAGOGA",
      schoolId: "escola-a",
      active: true,
      schools: [{ schoolId: "escola-a", role: "PEDAGOGA", active: true }],
      networks: [],
    },
  };

  state.schools = [
    {
      id: "escola-a",
      name: "Escola A",
      inepCode: "41000001",
      networkId: "net-1",
      network: "MUNICIPAL",
      city: "Tibagi",
      active: true,
      edition: "INSTITUCIONAL_ESSENCIAL",
    },
    {
      id: "escola-b",
      name: "Escola B",
      inepCode: "41000002",
      networkId: "net-2",
      network: "MUNICIPAL",
      city: "Castro",
      active: true,
      edition: "INSTITUCIONAL_ESSENCIAL",
    },
  ];

  state.users = [
    {
      id: "user-pedagoga-a",
      name: "Bruna Pedagoga",
      email: "pedagoga@escola-a.pr.gov.br",
      role: "PEDAGOGA",
      active: true,
      schoolId: "escola-a",
      schools: [{ schoolId: "escola-a", active: true }],
      networks: [],
    },
    {
      id: "user-gestor-a",
      name: "Carlos Diretor",
      email: "diretor@escola-a.pr.gov.br",
      role: "GESTOR_ESCOLAR",
      active: true,
      schoolId: "escola-a",
      schools: [{ schoolId: "escola-a", active: true }],
      networks: [],
    },
    {
      id: "user-inativo-a",
      name: "Desligada Escola A",
      email: "inativa@escola-a.pr.gov.br",
      role: "PEDAGOGA",
      active: false,
      schoolId: "escola-a",
      schools: [{ schoolId: "escola-a", active: false }],
      networks: [],
    },
    {
      id: "user-outro-vinculo-inativo",
      name: "Ex-servidora A",
      email: "ex@escola-a.pr.gov.br",
      role: "PEDAGOGA",
      active: true,
      schoolId: "escola-a",
      schools: [{ schoolId: "escola-a", active: false }],
      networks: [],
    },
    {
      id: "user-escola-b",
      name: "Docente Escola B",
      email: "b@escola-b.pr.gov.br",
      role: "GESTOR_ESCOLAR",
      active: true,
      schoolId: "escola-b",
      schools: [{ schoolId: "escola-b", active: true }],
      networks: [],
    },
    {
      id: "user-semec-net1",
      name: "Gestão Rede 1",
      email: "semec1@tibagi.pr.gov.br",
      role: "GESTAO_SECRETARIA",
      active: true,
      schoolId: null,
      schools: [],
      networks: [
        {
          networkId: "net-1",
          active: true,
          network: { id: "net-1", city: "Tibagi", active: true },
        },
      ],
    },
    {
      id: "user-semec-net2",
      name: "Gestão Rede 2",
      email: "semec2@castro.pr.gov.br",
      role: "GESTAO_SECRETARIA",
      active: true,
      schoolId: null,
      schools: [],
      networks: [
        {
          networkId: "net-2",
          active: true,
          network: { id: "net-2", city: "Castro", active: true },
        },
      ],
    },
  ];

  state.students = [
    {
      id: "stu-a1",
      name: "João Pedro",
      cgm: "1001",
      email: "joao@escola.pr.gov.br",
      phone: "42999990001",
      guardianName: "Maria Silva",
      schoolId: "escola-a",
      active: true,
      classGroup: { name: "6º 1" },
      contacts: [
        {
          id: "c-a1",
          studentId: "stu-a1",
          name: "Maria Silva",
          kinship: "MAE",
          phone: "42999990001",
          isPrimary: true,
        },
        {
          id: "c-a2",
          studentId: "stu-a1",
          name: "Vizinho Carlos",
          kinship: "RECADO",
          phone: "42988881111",
          isPrimary: false,
        },
      ],
    },
    {
      id: "stu-a-inativo",
      name: "Lucas Transferido",
      cgm: "1099",
      email: "lucas@escola.pr.gov.br",
      phone: "42999990099",
      guardianName: "Paula Souza",
      schoolId: "escola-a",
      active: false,
      classGroup: { name: "8º 2" },
      contacts: [],
    },
    {
      id: "stu-b1",
      name: "Aluno Escola B",
      cgm: "2001",
      email: "b@escola-b.pr.gov.br",
      phone: "42999992001",
      guardianName: "Responsável B",
      schoolId: "escola-b",
      active: true,
      classGroup: { name: "7º 1" },
      contacts: [],
    },
  ];

  state.minutes = [
    {
      id: "ata-conf-a",
      schoolId: "escola-a",
      year: 2026,
      status: "DRAFT",
      isConfidential: true,
      authorId: "user-gestor-a",
      authorEmail: "diretor@escola-a.pr.gov.br",
      attendedAt: new Date("2026-11-10T12:00:00Z"),
      subject: "Sigilo ECA",
      summary: "Texto restrito",
      students: [{ studentId: "stu-a1", studentNameSnapshot: "João Pedro" }],
      participants: [],
      actionItems: [],
    },
    {
      id: "ata-hist-inativo",
      schoolId: "escola-a",
      year: 2026,
      status: "DRAFT",
      isConfidential: false,
      authorId: "user-pedagoga-a",
      authorEmail: "pedagoga@escola-a.pr.gov.br",
      attendedAt: new Date("2026-11-12T12:00:00Z"),
      subject: "Ata histórica aluno inativo",
      summary: "Resumo histórico",
      students: [{ studentId: "stu-a-inativo", studentNameSnapshot: "Lucas Transferido" }],
      participants: [
        {
          id: "mp-signed-stu",
          minuteId: "ata-hist-inativo",
          role: "ESTUDANTE",
          studentId: "stu-a-inativo",
          name: "Lucas Transferido",
          documentType: "CGM",
          documentNumber: "1099",
          signatureMode: "SCREEN_CANVAS",
          signatureData: "data:image/png;base64,abc",
          hasSignature: true,
        },
      ],
      actionItems: [],
    },
  ];
});

describe("API Fase 2 — GET /api/atas/participant-candidates e revalidação multi-tenant", () => {
  it("permite PEDAGOGA em GET /api/atas/participant-candidates mantendo GET /api/users bloqueado (403)", async () => {
    const usersRes = await getUsers(new Request("http://localhost:3000/api/users"));
    expect(usersRes.status).toBe(403);

    const req = new Request(
      "http://localhost:3000/api/atas/participant-candidates?part=all&studentIds=stu-a1"
    );
    const res = await getParticipantCandidates(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("Cache-Control")).toContain("private");

    const json = await res.json();
    expect(json.schoolId).toBe("escola-a");

    // Staff com projeção estritamente mínima { id, name, email }, ordenado e sem inativos/outra escola
    expect(json.staff).toEqual([
      { id: "user-pedagoga-a", name: "Bruna Pedagoga", email: "pedagoga@escola-a.pr.gov.br" },
      { id: "user-gestor-a", name: "Carlos Diretor", email: "diretor@escola-a.pr.gov.br" },
    ]);
    for (const member of json.staff) {
      expect(Object.keys(member).sort()).toEqual(["email", "id", "name"]);
    }

    // Estudantes e contatos da pauta carregados apenas para stu-a1
    expect(json.students).toHaveLength(1);
    expect(json.students[0].id).toBe("stu-a1");
    expect(json.students[0].contacts).toHaveLength(2);
  });

  it("carrega equipe separadamente dos contatos e sinaliza staffTruncated quando exceder 200 servidores", async () => {
    for (let i = 1; i <= 205; i++) {
      state.users.push({
        id: `bulk-u-${i}`,
        name: `Servidor ${String(i).padStart(3, "0")}`,
        email: `srv${i}@escola-a.pr.gov.br`,
        role: "PEDAGOGA",
        active: true,
        schoolId: "escola-a",
        schools: [{ schoolId: "escola-a", active: true }],
        networks: [],
      });
    }

    const staffRes = await getParticipantCandidates(
      new Request("http://localhost:3000/api/atas/participant-candidates?part=staff")
    );
    expect(staffRes.status).toBe(200);
    const staffJson = await staffRes.json();
    expect(staffJson.staff).toHaveLength(200);
    expect(staffJson.staffTruncated).toBe(true);
    expect(staffJson.students).toBeUndefined();

    const contactsRes = await getParticipantCandidates(
      new Request("http://localhost:3000/api/atas/participant-candidates?part=contacts&studentIds=stu-a1")
    );
    expect(contactsRes.status).toBe(200);
    const contactsJson = await contactsRes.json();
    expect(contactsJson.staff).toBeUndefined();
    expect(contactsJson.students).toHaveLength(1);
  });

  it("bloqueia usuários inativos, vínculos desativados, schoolId divergente e studentIds/minuteId de outra escola", async () => {
    state.session.user.id = "user-inativo-a";
    const resInactive = await getParticipantCandidates(
      new Request("http://localhost:3000/api/atas/participant-candidates?part=staff")
    );
    expect(resInactive.status).toBe(403);

    state.session.user.id = "user-outro-vinculo-inativo";
    const resInactiveLink = await getParticipantCandidates(
      new Request("http://localhost:3000/api/atas/participant-candidates?part=staff")
    );
    expect(resInactiveLink.status).toBe(403);

    state.session.user.id = "user-pedagoga-a";
    const resMismatchSchool = await getParticipantCandidates(
      new Request("http://localhost:3000/api/atas/participant-candidates?part=staff&schoolId=escola-b")
    );
    expect(resMismatchSchool.status).toBe(403);

    const resCrossStudent = await getParticipantCandidates(
      new Request("http://localhost:3000/api/atas/participant-candidates?part=contacts&studentIds=stu-b1")
    );
    expect(resCrossStudent.status).toBe(403);

    // Ata confidencial de outro autor bloqueia PEDAGOGA com 403
    const resConf = await getParticipantCandidates(
      new Request("http://localhost:3000/api/atas/participant-candidates?part=contacts&minuteId=ata-conf-a&studentIds=stu-a1")
    );
    expect(resConf.status).toBe(403);
  });

  it("valida acesso real de GESTAO_SECRETARIA pela rede vinculada no banco, sem liberar pelo nome do papel", async () => {
    // Secretaria da Rede 2 tentando acessar Escola A (Rede 1) -> 403
    state.session.user = {
      id: "user-semec-net2",
      name: "Gestão Rede 2",
      email: "semec2@castro.pr.gov.br",
      role: "GESTAO_SECRETARIA",
      schoolId: "escola-a",
      active: true,
      schools: [],
      networks: [{ networkId: "net-2", active: true }],
    };
    const resDeniedSemec = await getParticipantCandidates(
      new Request("http://localhost:3000/api/atas/participant-candidates?part=staff")
    );
    expect(resDeniedSemec.status).toBe(403);

    // Secretaria da Rede 1 acessando Escola A (Rede 1) -> 200
    state.session.user = {
      id: "user-semec-net1",
      name: "Gestão Rede 1",
      email: "semec1@tibagi.pr.gov.br",
      role: "GESTAO_SECRETARIA",
      schoolId: "escola-a",
      active: true,
      schools: [],
      networks: [{ networkId: "net-1", active: true }],
    };
    const resAllowedSemec = await getParticipantCandidates(
      new Request("http://localhost:3000/api/atas/participant-candidates?part=staff")
    );
    expect(resAllowedSemec.status).toBe(200);
  });

  it("restringe estudante inativo apenas à ata histórica em que já está vinculado", async () => {
    const resNewMinute = await getParticipantCandidates(
      new Request("http://localhost:3000/api/atas/participant-candidates?part=contacts&studentIds=stu-a-inativo")
    );
    expect(resNewMinute.status).toBe(403);

    const resExistingMinute = await getParticipantCandidates(
      new Request(
        "http://localhost:3000/api/atas/participant-candidates?part=contacts&minuteId=ata-hist-inativo&studentIds=stu-a-inativo"
      )
    );
    expect(resExistingMinute.status).toBe(200);
    const json = await resExistingMinute.json();
    expect(json.students[0]).toMatchObject({
      id: "stu-a-inativo",
      isInactiveRecord: true,
    });
  });

  it("revalida participants[].studentId no servidor ao criar (POST), atualizar (PATCH) e lavrar (finalize), sem normalizar registro protegido", async () => {
    // 1. POST com participant.studentId de outra escola -> 403
    const createRes = await postAta(
      new Request("http://localhost:3000/api/atas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: "ACOMPANHAMENTO_PEDAGOGICO",
          subject: "Atendimento",
          studentIds: ["stu-a1"],
          participants: [
            {
              role: "ESTUDANTE",
              studentId: "stu-b1",
              name: "Aluno Escola B",
            },
          ],
        }),
      })
    );
    expect(createRes.status).toBe(403);

    // 2. PATCH em participante assinado (mp-signed-stu) tentando mudar role para RESPONSAVEL:
    // não pode normalizar studentId para null antes de comparar -> deve retornar 409 CONFLICT
    const patchProtectedConflict = await patchAta(
      new Request("http://localhost:3000/api/atas/ata-hist-inativo", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participants: [
            {
              id: "mp-signed-stu",
              role: "RESPONSAVEL",
              studentId: "stu-a-inativo",
              name: "Lucas Transferido",
              documentType: "CGM",
              documentNumber: "1099",
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: "ata-hist-inativo" }) }
    );
    expect(patchProtectedConflict.status).toBe(409);

    // 3. PATCH tentando vincular studentId de outra escola -> 403
    const patchCrossSchool = await patchAta(
      new Request("http://localhost:3000/api/atas/ata-hist-inativo", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participants: [
            {
              role: "ESTUDANTE",
              studentId: "stu-b1",
              name: "Intruso Escola B",
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: "ata-hist-inativo" }) }
    );
    expect(patchCrossSchool.status).toBe(403);

    // 4. executeMinuteFinalization (POST /finalize) também rejeita studentId de outra escola
    const { prisma } = await import("@/lib/prisma");
    await expect(
      executeMinuteFinalization({
        prisma,
        minuteId: "ata-hist-inativo",
        rawBody: {
          subject: "Atendimento finalizado",
          summary: "Registro detalhado da reunião com assinatura confirmada.",
          participants: [
            {
              id: "mp-signed-stu",
              role: "ESTUDANTE",
              studentId: "stu-a-inativo",
              name: "Lucas Transferido",
              documentType: "CGM",
              documentNumber: "1099",
            },
            {
              role: "ESTUDANTE",
              studentId: "stu-b1",
              name: "Invasor B",
            },
          ],
        },
        author: {
          userId: "user-pedagoga-a",
          userName: "Bruna Pedagoga",
          email: "pedagoga@escola-a.pr.gov.br",
          role: "PEDAGOGA",
        },
        verifyTenantOwnership: (sId) => sId === "escola-a",
      })
    ).rejects.toThrow(/FORBIDDEN/);
  });
});
