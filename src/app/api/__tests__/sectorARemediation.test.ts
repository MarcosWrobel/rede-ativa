import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const hoisted = vi.hoisted(() => ({
  session: null as any,
  currentSchool: {
    id: "school-a",
    inepCode: "41000001",
    name: "Escola Municipal Alpha",
    city: "Castro",
    state: "PR",
    nre: "SEMEC Castro",
    network: "MUNICIPAL",
    edition: "INSTITUCIONAL_ESSENCIAL" as const,
  },
  db: {
    schools: [] as any[],
    users: [] as any[],
    userSchools: [] as any[],
    userNetworks: [] as any[],
  },
  logAudit: vi.fn(async () => {}),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  userUpdate: vi.fn(),
  userFindUnique: vi.fn(),
  userSchoolUpsert: vi.fn(),
  schoolCreate: vi.fn(),
  schoolUpdate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => hoisted.session),
}));

vi.mock("@/lib/auth.config", () => ({
  authConfig: { providers: [], callbacks: {} },
}));

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({
    auth: vi.fn(async () => hoisted.session),
  })),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => hoisted.redirect(url),
}));

vi.mock("@/lib/currentSchool", () => ({
  getCurrentSchool: vi.fn(async () => hoisted.currentSchool),
  invalidateSchoolCache: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: hoisted.logAudit,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where?.id) return hoisted.db.schools.find((s) => s.id === where.id) || null;
        if (where?.inepCode) return hoisted.db.schools.find((s) => s.inepCode === where.inepCode) || null;
        return null;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        if (where?.inepCode) return hoisted.db.schools.find((s) => s.inepCode === where.inepCode) || null;
        if (where?.networkId) return hoisted.db.schools.find((s) => s.networkId === where.networkId) || null;
        return hoisted.db.schools[0] || null;
      }),
      findMany: vi.fn(async () => []),
      create: hoisted.schoolCreate,
      update: hoisted.schoolUpdate,
    },
    educationNetwork: {
      upsert: vi.fn(async ({ create }: any) => ({ id: create.id, ...create })),
    },
    messageTemplate: {
      create: vi.fn(async () => ({})),
    },
    userNetwork: {
      findMany: vi.fn(async ({ where }: any) =>
        hoisted.db.userNetworks.filter((un) => un.userId === where?.userId && un.active)
      ),
      upsert: vi.fn(async () => ({})),
    },
    userSchool: {
      findUnique: vi.fn(async ({ where }: any) => {
        const key = where?.userId_schoolId;
        if (!key) return null;
        return (
          hoisted.db.userSchools.find(
            (us) => us.userId === key.userId && us.schoolId === key.schoolId
          ) || null
        );
      }),
      upsert: hoisted.userSchoolUpsert,
    },
    user: {
      findUnique: hoisted.userFindUnique,
      update: hoisted.userUpdate,
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  },
}));

import { requireSchoolAdmin } from "@/lib/permissions";
import { POST as switchSchoolPost } from "@/app/api/auth/switch-school/route";
import { GET as secretariaMetricsGet } from "@/app/api/secretaria/metrics/route";
import { POST as createSchoolPost } from "@/app/api/schools/route";
import { PUT as updateSchoolPut } from "@/app/api/schools/[id]/route";
import { POST as createUserPost, PUT as updateUserPut } from "@/app/api/users/route";
import AdminEscolasPage from "@/app/admin/escolas/page";
import { proxy } from "@/proxy";

describe("Remediação Cirúrgica Setor A — RBAC, Multi-Tenant e Borda", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.db = {
      schools: [
        {
          id: "school-castro-mun",
          inepCode: "41000010",
          name: "E.M. Castro",
          city: "Castro",
          state: "PR",
          network: "MUNICIPAL",
          networkId: "semec-castro",
          active: true,
          settingsJson: null,
        },
        {
          id: "school-castro-est",
          inepCode: "41000011",
          name: "C.E. Castro Estadual",
          city: "Castro",
          state: "PR",
          network: "ESTADUAL",
          networkId: null,
          active: true,
          settingsJson: null,
        },
        {
          id: "school-tibagi-mun",
          inepCode: "41000020",
          name: "E.M. Tibagi",
          city: "Tibagi",
          state: "PR",
          network: "MUNICIPAL",
          networkId: "semec-tibagi",
          active: true,
          settingsJson: null,
        },
        {
          id: "cmvvaoxvl0000kw07c9m80sye",
          inepCode: "41042730",
          name: "Colégio Estadual Leopoldina B. Pedroso",
          city: "Ponta Grossa",
          state: "PR",
          network: "ESTADUAL",
          networkId: null,
          active: true,
          settingsJson: JSON.stringify({ edition: "PILOTO_INTEGRADA" }),
        },
      ],
      users: [
        {
          id: "usr-multi",
          email: "prof.multi@escola.pr.gov.br",
          name: "Docente Multi",
          role: "GESTOR_ESCOLAR",
          schoolId: "school-other",
          active: true,
        },
      ],
      userSchools: [
        { userId: "usr-multi", schoolId: "school-other", role: "GESTOR_ESCOLAR", active: true },
        { userId: "usr-multi", schoolId: "school-a", role: "PEDAGOGA", active: true },
      ],
      userNetworks: [
        {
          userId: "usr-sec-castro",
          networkId: "semec-castro",
          active: true,
          network: { id: "semec-castro", city: "Castro", type: "MUNICIPAL" },
        },
      ],
    };

    hoisted.userFindUnique.mockImplementation(async ({ where }: any) => {
      const u = hoisted.db.users.find(
        (x) => (where?.id && x.id === where.id) || (where?.email && x.email === where.email)
      );
      if (!u) return null;
      return {
        ...u,
        schools: hoisted.db.userSchools.filter((us) => us.userId === u.id),
        _count: { messageLogs: 0, repliedLogs: 0 },
      };
    });

    hoisted.userUpdate.mockImplementation(async ({ where, data }: any) => {
      const u = hoisted.db.users.find((x) => x.id === where.id);
      if (u) Object.assign(u, data);
      return {
        ...u,
        schools: [],
        _count: { messageLogs: 0, repliedLogs: 0 },
      };
    });

    hoisted.userSchoolUpsert.mockImplementation(async ({ where, update, create }: any) => {
      const { userId, schoolId } = where.userId_schoolId;
      const idx = hoisted.db.userSchools.findIndex(
        (us) => us.userId === userId && us.schoolId === schoolId
      );
      if (idx >= 0) {
        Object.assign(hoisted.db.userSchools[idx], update);
        return hoisted.db.userSchools[idx];
      }
      const item = { ...create };
      hoisted.db.userSchools.push(item);
      return item;
    });

    hoisted.schoolCreate.mockImplementation(async ({ data }: any) => ({
      id: "created-school-1",
      ...data,
    }));

    hoisted.schoolUpdate.mockImplementation(async ({ where, data }: any) => ({
      id: where.id,
      inepCode: "41000010",
      name: data.name || "E.M. Castro",
      city: "Castro",
      state: "PR",
      nre: data.nre || "SEMEC Castro",
      network: "MUNICIPAL",
      phone: data.phone ?? null,
      email: data.email ?? null,
      active: true,
      syncTokenHash: null,
      settingsJson: data.settingsJson ?? null,
      networkId: "semec-castro",
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
  });

  it("1. Isola GESTAO_SECRETARIA em requireSchoolAdmin por rede/município MUNICIPAL", async () => {
    hoisted.session = {
      user: {
        id: "usr-sec-castro",
        email: "sec@castro.pr.gov.br",
        role: "GESTAO_SECRETARIA",
        active: true,
        networks: [{ networkId: "semec-castro", city: "Castro", type: "MUNICIPAL" }],
      },
    };

    const allowedRes = await requireSchoolAdmin("school-castro-mun");
    expect(allowedRes.ok).toBe(true);

    const estadualSameCityRes = await requireSchoolAdmin("school-castro-est");
    expect(estadualSameCityRes.ok).toBe(false);
    if (!estadualSameCityRes.ok) expect(estadualSameCityRes.response.status).toBe(403);

    const otherCityRes = await requireSchoolAdmin("school-tibagi-mun");
    expect(otherCityRes.ok).toBe(false);
    if (!otherCityRes.ok) expect(otherCityRes.response.status).toBe(403);
  });

  it("2. Bloqueia troca de escola estadual em switch-school e grava targetSchool.id canônico", async () => {
    hoisted.session = {
      user: {
        id: "usr-sec-castro",
        email: "sec@castro.pr.gov.br",
        role: "GESTAO_SECRETARIA",
        active: true,
      },
    };

    const deniedRes = await switchSchoolPost(
      new Request("http://localhost/api/auth/switch-school", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId: "school-castro-est" }),
      })
    );
    expect(deniedRes.status).toBe(403);

    hoisted.session = {
      user: {
        id: "usr-super",
        email: "marcos.wrobel@escola.pr.gov.br",
        role: "SUPERADMIN",
        active: true,
      },
    };

    const pilotRes = await switchSchoolPost(
      new Request("http://localhost/api/auth/switch-school", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId: "41042730" }),
      })
    );
    expect(pilotRes.status).toBe(200);
    const setCookie = pilotRes.headers.get("set-cookie") || "";
    expect(setCookie).toContain("active_school_id=cmvvaoxvl0000kw07c9m80sye");
    expect(setCookie).not.toContain("active_school_id=41042730");
    expect(hoisted.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "cmvvaoxvl0000kw07c9m80sye",
        schoolId: "cmvvaoxvl0000kw07c9m80sye",
      })
    );
  });

  it("3. Bloqueia /api/secretaria/metrics com 403 quando GESTAO_SECRETARIA não possui rede vinculada", async () => {
    hoisted.session = {
      user: {
        id: "usr-sec-sem-rede",
        email: "semrede@municipio.pr.gov.br",
        role: "GESTAO_SECRETARIA",
        active: true,
        networks: [],
      },
    };

    const res = await secretariaMetricsGet(new Request("http://localhost/api/secretaria/metrics"));
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe("Nenhuma rede municipal vinculada ao seu perfil.");
  });

  it("4. Bloqueia autoelevação de edição e metadados em POST /api/schools e PUT /api/schools/[id]", async () => {
    hoisted.session = {
      user: {
        id: "usr-sec-sem-rede",
        email: "sec@semrede.pr.gov.br",
        role: "GESTAO_SECRETARIA",
        active: true,
        networks: [],
      },
    };

    const noCityRes = await createSchoolPost(
      new Request("http://localhost/api/schools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inepCode: "41099901", name: "E.M. Sem Rede", city: "Tibagi" }),
      })
    );
    expect(noCityRes.status).toBe(403);

    hoisted.session = {
      user: {
        id: "usr-sec-castro",
        email: "sec@castro.pr.gov.br",
        role: "GESTAO_SECRETARIA",
        active: true,
        networks: [{ networkId: "semec-castro", city: "Castro", type: "MUNICIPAL" }],
      },
    };

    const editionAttemptRes = await createSchoolPost(
      new Request("http://localhost/api/schools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inepCode: "41099902",
          name: "E.M. Elevada",
          city: "Castro",
          edition: "PILOTO_INTEGRADA",
        }),
      })
    );
    expect(editionAttemptRes.status).toBe(403);

    hoisted.session = {
      user: {
        id: "usr-gestor-castro",
        email: "diretor@castro.pr.gov.br",
        role: "GESTOR_ESCOLAR",
        active: true,
        schoolId: "school-castro-mun",
        schools: [{ schoolId: "school-castro-mun", role: "GESTOR_ESCOLAR" }],
      },
    };

    for (const forbiddenBody of [
      { edition: "PILOTO_INTEGRADA" },
      { settings: { enablePowerBiSync: true } },
      { settingsJson: JSON.stringify({ edition: "PILOTO_INTEGRADA" }) },
      { inepCode: "41099999" },
      { network: "ESTADUAL" },
      { networkId: "outra-rede" },
    ]) {
      const res = await updateSchoolPut(
        new Request("http://localhost/api/schools/school-castro-mun", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Nome OK", ...forbiddenBody }),
        }),
        { params: Promise.resolve({ id: "school-castro-mun" }) }
      );
      expect(res.status).toBe(403);
    }

    const okUpdate = await updateSchoolPut(
      new Request("http://localhost/api/schools/school-castro-mun", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "E.M. Castro Atualizada",
          network: "MUNICIPAL",
          phone: "(42) 3232-0000",
        }),
      }),
      { params: Promise.resolve({ id: "school-castro-mun" }) }
    );
    expect(okUpdate.status).toBe(200);
  });

  it("5. Restringe /admin e /admin/escolas estritamente ao SUPERADMIN", async () => {
    hoisted.session = {
      user: {
        id: "usr-sec-castro",
        email: "sec@castro.pr.gov.br",
        role: "GESTAO_SECRETARIA",
        active: true,
      },
    };

    await expect(AdminEscolasPage()).rejects.toThrow("NEXT_REDIRECT:/secretaria");

    const proxyRes = await proxy(new NextRequest("http://localhost:3000/admin/escolas"));
    expect(proxyRes.status).toBe(307);
    expect(proxyRes.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("6. Preserva User.role e User.active globais em POST e PUT /api/users para usuários multi-escola", async () => {
    hoisted.session = {
      user: {
        id: "usr-gestor-a",
        email: "diretor@school-a.pr.gov.br",
        role: "GESTOR_ESCOLAR",
        active: true,
        schoolId: "school-a",
        schools: [{ schoolId: "school-a", role: "GESTOR_ESCOLAR" }],
      },
    };

    // PUT desativando vínculo local em school-a de usuário que também pertence a school-other
    const putRes = await updateUserPut(
      new Request("http://localhost/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "usr-multi", role: "PEDAGOGA", active: false }),
      })
    );
    expect(putRes.status).toBe(200);
    expect(hoisted.userUpdate).not.toHaveBeenCalled();
    expect(hoisted.db.users.find((u) => u.id === "usr-multi")?.active).toBe(true);
    expect(hoisted.db.users.find((u) => u.id === "usr-multi")?.role).toBe("GESTOR_ESCOLAR");
    expect(
      hoisted.db.userSchools.find((us) => us.userId === "usr-multi" && us.schoolId === "school-a")?.active
    ).toBe(false);

    // POST reinvidicando/reativando em school-a um usuário existente de school-other com cargo GESTOR_ESCOLAR
    hoisted.db.users[0].role = "PEDAGOGA";
    const postRes = await createUserPost(
      new Request("http://localhost/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "prof.multi@escola.pr.gov.br",
          role: "GESTOR_ESCOLAR",
        }),
      })
    );
    expect(postRes.status).toBe(201);
    expect(hoisted.userUpdate).not.toHaveBeenCalled();
    expect(hoisted.db.users[0].role).toBe("PEDAGOGA");
    expect(
      hoisted.db.userSchools.find((us) => us.userId === "usr-multi" && us.schoolId === "school-a")?.role
    ).toBe("GESTOR_ESCOLAR");
  });
});
