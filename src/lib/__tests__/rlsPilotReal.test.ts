import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/rlsTenantContext";

const SHOULD_RUN = process.env.RUN_RLS_PILOT_TEST === "true";

function assertSafeLocalPilotUrl(rawUrl: string | undefined, label: string): string {
  if (!rawUrl) {
    throw new Error(`${label} é obrigatório quando RUN_RLS_PILOT_TEST=true.`);
  }
  const parsed = new URL(rawUrl);
  const host = parsed.hostname.toLowerCase();
  const dbName = parsed.pathname.replace(/^\//, "").toLowerCase();
  const isLoopback = host === "127.0.0.1" || host === "localhost";
  const isSyntheticDb = dbName.includes("rls_pilot_test");
  if (!isLoopback || !isSyntheticDb) {
    throw new Error(
      `${label} recusado por segurança: exige host loopback e banco sintético 'rls_pilot_test'.`
    );
  }
  return rawUrl;
}

describe.skipIf(!SHOULD_RUN)("Piloto Técnico Isolado — PostgreSQL 16 RLS + FKs Compostas", () => {
  let adminPrisma: PrismaClient;
  let runtimePrisma: PrismaClient;

  beforeAll(async () => {
    const adminUrl = assertSafeLocalPilotUrl(
      process.env.RLS_PILOT_ADMIN_URL,
      "RLS_PILOT_ADMIN_URL"
    );
    const runtimeUrl = assertSafeLocalPilotUrl(
      process.env.RLS_PILOT_RUNTIME_URL,
      "RLS_PILOT_RUNTIME_URL"
    );

    adminPrisma = new PrismaClient({ datasources: { db: { url: adminUrl } } });
    runtimePrisma = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });

    await adminPrisma.$connect();
    await runtimePrisma.$connect();
  });

  beforeEach(async () => {
    await adminPrisma.messageLog.deleteMany({});
    await adminPrisma.messageTemplate.deleteMany({});
    await adminPrisma.student.deleteMany({});
    await adminPrisma.classGroup.deleteMany({});
    await adminPrisma.school.deleteMany({});

    await adminPrisma.school.createMany({
      data: [
        {
          id: "school-alpha",
          inepCode: "99000001",
          name: "Escola Sintética Alpha",
          city: "Cidade Teste",
          state: "PR",
          nre: "NRE Teste",
          network: "MUNICIPAL",
          active: true,
        },
        {
          id: "school-beta",
          inepCode: "99000002",
          name: "Escola Sintética Beta",
          city: "Cidade Teste",
          state: "PR",
          nre: "NRE Teste",
          network: "MUNICIPAL",
          active: true,
        },
      ],
    });
  });

  afterAll(async () => {
    await runtimePrisma?.$disconnect();
    await adminPrisma?.$disconnect();
  });

  it("permite leitura e escrita autorizadas ao fluxo ClassGroup -> Student -> MessageTemplate -> MessageLog via withTenantContext", async () => {
    const created = await withTenantContext(runtimePrisma, "school-alpha", async (tx) => {
      const classGroup = await tx.classGroup.create({
        data: {
          id: "cg-alpha-1",
          name: "7º Ano A",
          segment: "FUNDAMENTAL",
          shift: "MANHA",
          schoolId: "school-alpha",
        },
      });
      const student = await tx.student.create({
        data: {
          id: "st-alpha-1",
          name: "Estudante Sintético Alpha",
          phone: "41999990001",
          classGroupId: classGroup.id,
          schoolId: "school-alpha",
        },
      });
      const template = await tx.messageTemplate.create({
        data: {
          id: "tpl-alpha-1",
          title: "AVISO SINTÉTICO",
          prefixText: "Olá,",
          suffixText: "Atenciosamente.",
          schoolId: "school-alpha",
        },
      });
      const log = await tx.messageLog.create({
        data: {
          id: "msg-alpha-1",
          studentId: student.id,
          templateId: template.id,
          reasonTitle: "AVISO SINTÉTICO",
          messageContent: "Mensagem sintética para verificação de RLS.",
          phoneUsed: student.phone,
          sentByName: "Equipe Sintética",
        },
      });
      return { classGroup, student, template, log };
    });

    expect(created.student.schoolId).toBe("school-alpha");

    const alphaLogs = await withTenantContext(runtimePrisma, "school-alpha", async (tx) =>
      tx.messageLog.findMany({ include: { student: true, template: true } })
    );
    expect(alphaLogs).toHaveLength(1);
    expect(alphaLogs[0].student.name).toBe("Estudante Sintético Alpha");
  });

  it("bloqueia leitura cruzada (0 linhas) e escrita cruzada (SQLSTATE 42501 / FK 23503)", async () => {
    await withTenantContext(runtimePrisma, "school-beta", async (tx) => {
      await tx.classGroup.create({
        data: {
          id: "cg-beta-1",
          name: "8º Ano B",
          segment: "FUNDAMENTAL",
          shift: "TARDE",
          schoolId: "school-beta",
        },
      });
      await tx.student.create({
        data: {
          id: "st-beta-1",
          name: "Estudante Sintético Beta",
          phone: "41999990002",
          classGroupId: "cg-beta-1",
          schoolId: "school-beta",
        },
      });
      await tx.messageTemplate.create({
        data: {
          id: "tpl-beta-1",
          title: "TEMPLATE BETA",
          prefixText: "Olá,",
          suffixText: "Equipe.",
          schoolId: "school-beta",
        },
      });
      await tx.messageLog.create({
        data: {
          id: "msg-beta-1",
          studentId: "st-beta-1",
          templateId: "tpl-beta-1",
          reasonTitle: "TEMPLATE BETA",
          messageContent: "Registro exclusivo Beta.",
          phoneUsed: "41999990002",
          sentByName: "Equipe Beta",
        },
      });
    });

    // Leitura cruzada a partir de Alpha deve enxergar ZERO linhas de Beta
    const crossRead = await withTenantContext(runtimePrisma, "school-alpha", async (tx) => ({
      classes: await tx.classGroup.findMany(),
      students: await tx.student.findMany(),
      templates: await tx.messageTemplate.findMany(),
      logs: await tx.messageLog.findMany(),
    }));

    expect(crossRead.classes).toHaveLength(0);
    expect(crossRead.students).toHaveLength(0);
    expect(crossRead.templates).toHaveLength(0);
    expect(crossRead.logs).toHaveLength(0);

    // Tentativa de gravar ClassGroup de school-beta enquanto contexto ativo é school-alpha -> 42501
    await expect(
      withTenantContext(runtimePrisma, "school-alpha", async (tx) =>
        tx.classGroup.create({
          data: {
            id: "cg-hijack",
            name: "Injeção Cruzada",
            segment: "FUNDAMENTAL",
            shift: "MANHA",
            schoolId: "school-beta",
          },
        })
      )
    ).rejects.toThrow(/42501|row-level security/i);

    // Tentativa de Student em school-alpha referenciar classGroupId de school-beta -> FK composta 23503
    await expect(
      withTenantContext(runtimePrisma, "school-alpha", async (tx) =>
        tx.student.create({
          data: {
            id: "st-fk-hijack",
            name: "FK Cruzada",
            phone: "41999990099",
            classGroupId: "cg-beta-1",
            schoolId: "school-alpha",
          },
        })
      )
    ).rejects.toThrow(/23503|foreign key|Student_schoolId_classGroupId_fkey/i);

    // Tentativa de MessageLog em school-alpha referenciar studentId de school-beta -> FK composta 23503
    await expect(
      withTenantContext(runtimePrisma, "school-alpha", async (tx) =>
        tx.messageLog.create({
          data: {
            id: "msg-fk-hijack",
            studentId: "st-beta-1",
            reasonTitle: "FK Cruzada",
            messageContent: "Tentativa cruzada",
            phoneUsed: "41999990099",
            sentByName: "Atacante",
          },
        })
      )
    ).rejects.toThrow(/23503|foreign key|MessageLog_schoolId_studentId_fkey/i);
  });

  it("preserva MessageLog.schoolId ao excluir MessageTemplate (ON DELETE SET NULL ('templateId'))", async () => {
    await withTenantContext(runtimePrisma, "school-alpha", async (tx) => {
      await tx.classGroup.create({
        data: {
          id: "cg-del-1",
          name: "9º Ano A",
          segment: "FUNDAMENTAL",
          shift: "MANHA",
          schoolId: "school-alpha",
        },
      });
      await tx.student.create({
        data: {
          id: "st-del-1",
          name: "Estudante Preservação",
          phone: "41999990003",
          classGroupId: "cg-del-1",
          schoolId: "school-alpha",
        },
      });
      await tx.messageTemplate.create({
        data: {
          id: "tpl-del-1",
          title: "MODELO TEMPORÁRIO",
          prefixText: "Olá,",
          suffixText: "Fim.",
          schoolId: "school-alpha",
        },
      });
      await tx.messageLog.create({
        data: {
          id: "msg-del-1",
          studentId: "st-del-1",
          templateId: "tpl-del-1",
          reasonTitle: "MODELO TEMPORÁRIO",
          messageContent: "Conteúdo mantido após exclusão do template.",
          phoneUsed: "41999990003",
          sentByName: "Equipe",
        },
      });
    });

    await withTenantContext(runtimePrisma, "school-alpha", async (tx) => {
      await tx.messageTemplate.delete({ where: { id: "tpl-del-1" } });
    });

    const rows = await adminPrisma.$queryRaw<Array<{ id: string; schoolId: string; templateId: string | null }>>`
      SELECT "id", "schoolId", "templateId" FROM "MessageLog" WHERE "id" = 'msg-del-1'
    `;
    expect(rows).toEqual([
      { id: "msg-del-1", schoolId: "school-alpha", templateId: null },
    ]);
  });

  it("falha fechado sem contexto (0 linhas em leitura e 42501 em escrita)", async () => {
    await withTenantContext(runtimePrisma, "school-alpha", async (tx) => {
      await tx.classGroup.create({
        data: {
          id: "cg-failclosed",
          name: "6º Ano C",
          segment: "FUNDAMENTAL",
          shift: "MANHA",
          schoolId: "school-alpha",
        },
      });
    });

    // Sem withTenantContext -> leitura retorna 0 linhas
    const noCtxClasses = await runtimePrisma.classGroup.findMany();
    const noCtxStudents = await runtimePrisma.student.findMany();
    const noCtxTemplates = await runtimePrisma.messageTemplate.findMany();
    const noCtxLogs = await runtimePrisma.messageLog.findMany();
    expect(noCtxClasses).toHaveLength(0);
    expect(noCtxStudents).toHaveLength(0);
    expect(noCtxTemplates).toHaveLength(0);
    expect(noCtxLogs).toHaveLength(0);

    const schemaCol = await adminPrisma.$queryRaw<Array<{ is_nullable: string }>>`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'MessageLog' AND column_name = 'schoolId'
    `;
    expect(schemaCol).toEqual([{ is_nullable: "NO" }]);

    // Sem withTenantContext -> escrita em MessageLog também falha fechado (NOT NULL / 42501)
    await expect(
      runtimePrisma.messageLog.create({
        data: {
          id: "msg-noctx-write",
          studentId: "st-alpha-1",
          reasonTitle: "Sem Contexto",
          messageContent: "Deve falhar",
          phoneUsed: "41999990001",
          sentByName: "Teste",
        },
      })
    ).rejects.toThrow(/23502|null value|42501|row-level security/i);

    // Sem withTenantContext -> escrita falha com 42501
    await expect(
      runtimePrisma.classGroup.create({
        data: {
          id: "cg-noctx-write",
          name: "Sem Contexto",
          segment: "FUNDAMENTAL",
          shift: "MANHA",
          schoolId: "school-alpha",
        },
      })
    ).rejects.toThrow(/42501|row-level security/i);
  });

  it("comprova descarte de app.current_school_id entre transações sequenciais na mesma conexão (connection_limit=1)", async () => {
    await withTenantContext(runtimePrisma, "school-alpha", async (tx) => {
      await tx.classGroup.create({
        data: {
          id: "cg-pool-a",
          name: "Turma Pool A",
          segment: "FUNDAMENTAL",
          shift: "MANHA",
          schoolId: "school-alpha",
        },
      });
    });
    await withTenantContext(runtimePrisma, "school-beta", async (tx) => {
      await tx.classGroup.create({
        data: {
          id: "cg-pool-b",
          name: "Turma Pool B",
          segment: "FUNDAMENTAL",
          shift: "MANHA",
          schoolId: "school-beta",
        },
      });
    });

    const tx1 = await withTenantContext(runtimePrisma, "school-alpha", async (tx) => {
      const pidRow = await tx.$queryRaw<Array<{ pid: number; setting: string | null }>>`
        SELECT pg_backend_pid()::int AS pid, NULLIF(current_setting('app.current_school_id', true), '') AS setting
      `;
      const classes = await tx.classGroup.findMany();
      return { pid: pidRow[0].pid, setting: pidRow[0].setting, ids: classes.map((c) => c.id) };
    });

    const tx2 = await withTenantContext(runtimePrisma, "school-beta", async (tx) => {
      const pidRow = await tx.$queryRaw<Array<{ pid: number; setting: string | null }>>`
        SELECT pg_backend_pid()::int AS pid, NULLIF(current_setting('app.current_school_id', true), '') AS setting
      `;
      const classes = await tx.classGroup.findMany();
      return { pid: pidRow[0].pid, setting: pidRow[0].setting, ids: classes.map((c) => c.id) };
    });

    const afterTx = await runtimePrisma.$transaction(async (tx) => {
      const pidRow = await tx.$queryRaw<Array<{ pid: number; setting: string | null }>>`
        SELECT pg_backend_pid()::int AS pid, NULLIF(current_setting('app.current_school_id', true), '') AS setting
      `;
      const classes = await tx.classGroup.findMany();
      return { pid: pidRow[0].pid, setting: pidRow[0].setting, ids: classes.map((c) => c.id) };
    });

    // Com connection_limit=1, todas as transações reutilizam exatamente o mesmo backend PostgreSQL
    expect(tx1.pid).toBe(tx2.pid);
    expect(tx2.pid).toBe(afterTx.pid);

    expect(tx1.setting).toBe("school-alpha");
    expect(tx1.ids).toEqual(["cg-pool-a"]);

    expect(tx2.setting).toBe("school-beta");
    expect(tx2.ids).toEqual(["cg-pool-b"]);

    expect(afterTx.setting).toBeNull();
    expect(afterTx.ids).toEqual([]);
  });
});
