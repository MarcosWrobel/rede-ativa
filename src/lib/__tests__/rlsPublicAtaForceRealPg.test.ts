import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";

const prismaRef = vi.hoisted(() => ({ current: null as unknown as PrismaClient }));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, prop) {
        return (prismaRef.current as unknown as Record<string | symbol, unknown>)[prop];
      },
    }
  ),
}));

vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return {
    ...actual,
    logAudit: vi.fn(async () => {}),
  };
});

import { GET as getPublicAtaRoute } from "@/app/api/atas/public/[code]/route";
import ValidarAtaPage from "@/app/validar/ata/[code]/page";
import { computeAddendumHash, computeMinuteHash } from "@/lib/ataCrypto";
import { withTenantContext } from "@/lib/rlsTenantContext";
import { logAudit } from "@/lib/audit";

const SHOULD_RUN = process.env.RUN_RLS_PUBLIC_ATA_FORCE_TEST === "true";

function assertSafeLocalForceDbUrl(rawUrl: string | undefined, label: string): string {
  if (!rawUrl) {
    throw new Error(`${label} é obrigatório quando RUN_RLS_PUBLIC_ATA_FORCE_TEST=true.`);
  }
  const parsed = new URL(rawUrl);
  const host = parsed.hostname.toLowerCase();
  const dbName = parsed.pathname.replace(/^\//, "").toLowerCase();
  const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  const isSynthetic = dbName.includes("rls_public_ata_force_test");
  if (!isLoopback || !isSynthetic) {
    throw new Error(
      `${label} recusada por segurança: exige host loopback e banco sintético 'rls_public_ata_force_test'.`
    );
  }
  return rawUrl;
}

describe.skipIf(!SHOULD_RUN)(
  "Consulta pública de Atas por código com app_runtime sob FORCE RLS (PostgreSQL 16 local)",
  () => {
    let adminPrisma: PrismaClient;
    let runtimePrisma: PrismaClient;
    let otherConsumerPrisma: PrismaClient;
    const prevSecDefEnv = process.env.RLS_PUBLIC_ATA_SECDEF_RESOLVER;

    beforeAll(async () => {
      const adminUrl = assertSafeLocalForceDbUrl(
        process.env.RLS_PUBLIC_ATA_ADMIN_URL,
        "RLS_PUBLIC_ATA_ADMIN_URL"
      );
      adminPrisma = new PrismaClient({ datasources: { db: { url: adminUrl } } });
      await adminPrisma.$connect();

      const setupSqlPath = path.resolve(
        process.cwd(),
        "lab/rls-pilot/public_ata_force_rls_setup.sql"
      );
      const setupSql = fs.readFileSync(setupSqlPath, "utf8");
      const statements: string[] = [];
      let current = "";
      let inDollar = false;
      for (let i = 0; i < setupSql.length; i++) {
        if (setupSql[i] === "$" && setupSql[i + 1] === "$") {
          inDollar = !inDollar;
          current += "$$";
          i++;
          continue;
        }
        if (setupSql[i] === ";" && !inDollar) {
          const trimmed = current.trim();
          if (trimmed && !trimmed.split("\n").every((l) => !l.trim() || l.trim().startsWith("--"))) {
            statements.push(trimmed);
          }
          current = "";
          continue;
        }
        current += setupSql[i];
      }
      if (current.trim()) statements.push(current.trim());
      for (const stmt of statements) {
        await adminPrisma.$executeRawUnsafe(stmt);
      }

      const baseParsed = new URL(adminUrl);
      const runtimeUrl = new URL(baseParsed.toString());
      runtimeUrl.username = "app_runtime";
      runtimeUrl.password = "rls_lab_runtime_pass";
      runtimeUrl.searchParams.set("connection_limit", "1");

      const otherUrl = new URL(baseParsed.toString());
      otherUrl.username = "app_other_consumer";
      otherUrl.password = "rls_lab_other_pass";
      otherUrl.searchParams.set("connection_limit", "1");

      runtimePrisma = new PrismaClient({ datasources: { db: { url: runtimeUrl.toString() } } });
      otherConsumerPrisma = new PrismaClient({ datasources: { db: { url: otherUrl.toString() } } });
      await runtimePrisma.$connect();
      await otherConsumerPrisma.$connect();

      prismaRef.current = runtimePrisma;
      process.env.RLS_PUBLIC_ATA_SECDEF_RESOLVER = "true";

      // Limpeza e carga de duas escolas sintéticas usando credencial administrativa separada
      await adminPrisma.pedagogicalMinuteAddendum.deleteMany({
        where: { minuteId: { in: ["fpub-ata-alpha", "fpub-ata-beta", "fpub-ata-void", "fpub-ata-draft"] } },
      });
      await adminPrisma.pedagogicalActionItem.deleteMany({
        where: { minuteId: { in: ["fpub-ata-alpha", "fpub-ata-beta", "fpub-ata-void", "fpub-ata-draft"] } },
      });
      await adminPrisma.pedagogicalMinuteParticipant.deleteMany({
        where: { minuteId: { in: ["fpub-ata-alpha", "fpub-ata-beta", "fpub-ata-void", "fpub-ata-draft"] } },
      });
      await adminPrisma.pedagogicalMinuteStudent.deleteMany({
        where: { minuteId: { in: ["fpub-ata-alpha", "fpub-ata-beta", "fpub-ata-void", "fpub-ata-draft"] } },
      });
      await adminPrisma.pedagogicalMinute.deleteMany({
        where: { schoolId: { in: ["force-pub-alpha", "force-pub-beta"] } },
      });
      await adminPrisma.student.deleteMany({
        where: { schoolId: { in: ["force-pub-alpha", "force-pub-beta"] } },
      });
      await adminPrisma.classGroup.deleteMany({
        where: { schoolId: { in: ["force-pub-alpha", "force-pub-beta"] } },
      });
      await adminPrisma.school.deleteMany({
        where: { id: { in: ["force-pub-alpha", "force-pub-beta"] } },
      });

      await adminPrisma.school.createMany({
        data: [
          { id: "force-pub-alpha", name: "Colégio Force Alpha", inepCode: "99140101", city: "Curitiba", state: "PR", nre: "Curitiba", active: true },
          { id: "force-pub-beta", name: "Colégio Force Beta", inepCode: "99140102", city: "Londrina", state: "PR", nre: "Londrina", active: true },
        ],
      });
      await adminPrisma.classGroup.createMany({
        data: [
          { id: "fpub-cg-alpha", schoolId: "force-pub-alpha", name: "6º Ano A", shift: "Manhã", segment: "FUNDAMENTAL" },
          { id: "fpub-cg-beta", schoolId: "force-pub-beta", name: "6º Ano A", shift: "Manhã", segment: "FUNDAMENTAL" },
        ],
      });
      await adminPrisma.student.createMany({
        data: [
          { id: "fpub-stu-alpha", schoolId: "force-pub-alpha", classGroupId: "fpub-cg-alpha", name: "Aluno Force Alpha", phone: "41999991501", cgm: "777111222", active: true },
          { id: "fpub-stu-beta", schoolId: "force-pub-beta", classGroupId: "fpub-cg-beta", name: "Aluno Force Beta", phone: "41999991502", cgm: "888111222", active: true },
        ],
      });

      const attendedAt = new Date("2026-11-22T14:00:00.000Z");
      const finalizedAt = new Date("2026-11-22T15:00:00.000Z");
      const addendumCreatedAt = new Date("2026-11-23T10:00:00.000Z");

      const makeSigned = (p: {
        id: string;
        schoolId: string;
        ataNumber: number;
        studentId: string;
        studentName: string;
        cgm: string;
        partName: string;
        docNum: string;
        email: string;
      }) => {
        const sigData = `data:image/png;base64,SIG_FORCE_${p.id}`;
        const bioData = JSON.stringify([{ x: 10, y: 20, t: 5, p: 0.4 }]);
        const subject = `Assunto Interno ${p.id}`;
        const summary = `Relato Interno ${p.id}`;
        const agreementsSummary = `Combinado Interno ${p.id}`;
        const authorEmail = `autora.${p.id}@escola.pr.gov.br`;
        const hash = computeMinuteHash({
          schoolId: p.schoolId,
          year: 2026,
          ataNumber: p.ataNumber,
          attendedAt: attendedAt.toISOString(),
          category: "ATENDIMENTO_FAMILIA",
          isConfidential: false,
          isExtemporaneous: false,
          extemporaneousReason: null,
          subject,
          summary,
          agreementsSummary,
          authorEmail,
          students: [{ studentId: p.studentId, name: p.studentName, className: "6º Ano A", cgm: p.cgm }],
          participants: [
            {
              role: "MOTHER",
              name: p.partName,
              documentType: "CPF",
              documentNumber: p.docNum,
              signatureMode: "DRAW",
              signatureData: sigData,
              biometricStrokeData: bioData,
              biometricVerified: true,
              verifiedEmail: p.email,
              refusalReason: null,
            },
          ],
          actionItems: [{ description: `Ação ${p.id}`, responsible: "Equipe", dueDate: null }],
        });
        const addHash = computeAddendumHash(hash, `Em tempo ${p.id}`, authorEmail, addendumCreatedAt.toISOString());
        return { hash, addHash, sigData, bioData, subject, summary, agreementsSummary, authorEmail };
      };

      const alphaC = makeSigned({
        id: "fpub-ata-alpha",
        schoolId: "force-pub-alpha",
        ataNumber: 1,
        studentId: "fpub-stu-alpha",
        studentName: "Aluno Force Alpha",
        cgm: "777111222",
        partName: "Maria Force Alpha",
        docNum: "12345678901",
        email: "maria.force@escola.pr.gov.br",
      });
      const betaC = makeSigned({
        id: "fpub-ata-beta",
        schoolId: "force-pub-beta",
        ataNumber: 1,
        studentId: "fpub-stu-beta",
        studentName: "Aluno Force Beta",
        cgm: "888111222",
        partName: "Joao Force Beta",
        docNum: "98765432100",
        email: "joao.force@escola.pr.gov.br",
      });
      const voidC = makeSigned({
        id: "fpub-ata-void",
        schoolId: "force-pub-alpha",
        ataNumber: 2,
        studentId: "fpub-stu-alpha",
        studentName: "Aluno Force Alpha",
        cgm: "777111222",
        partName: "Maria Force Void",
        docNum: "11122233344",
        email: "void.force@escola.pr.gov.br",
      });
      const draftC = makeSigned({
        id: "fpub-ata-draft",
        schoolId: "force-pub-alpha",
        ataNumber: 3,
        studentId: "fpub-stu-alpha",
        studentName: "Aluno Force Alpha",
        cgm: "777111222",
        partName: "Maria Force Draft",
        docNum: "55566677788",
        email: "draft.force@escola.pr.gov.br",
      });

      await adminPrisma.pedagogicalMinute.createMany({
        data: [
          {
            id: "fpub-ata-alpha",
            schoolId: "force-pub-alpha",
            year: 2026,
            ataNumber: 1,
            status: "FINALIZED",
            category: "ATENDIMENTO_FAMILIA",
            subject: alphaC.subject,
            summary: alphaC.summary,
            agreementsSummary: alphaC.agreementsSummary,
            attendedAt,
            finalizedAt,
            authorName: "Ana Pedagoga Alpha",
            authorRole: "Pedagoga",
            authorEmail: alphaC.authorEmail,
            contentHash: alphaC.hash,
            verificationCode: "FORCE-ATA-ALPHA-1",
          },
          {
            id: "fpub-ata-beta",
            schoolId: "force-pub-beta",
            year: 2026,
            ataNumber: 1,
            status: "FINALIZED",
            category: "ATENDIMENTO_FAMILIA",
            subject: betaC.subject,
            summary: betaC.summary,
            agreementsSummary: betaC.agreementsSummary,
            attendedAt,
            finalizedAt,
            authorName: "Carlos Pedagogo Beta",
            authorRole: "Pedagogo",
            authorEmail: betaC.authorEmail,
            contentHash: betaC.hash,
            verificationCode: "FORCE-ATA-BETA-1",
          },
          {
            id: "fpub-ata-void",
            schoolId: "force-pub-alpha",
            year: 2026,
            ataNumber: 2,
            status: "VOIDED",
            category: "ATENDIMENTO_FAMILIA",
            subject: voidC.subject,
            summary: voidC.summary,
            agreementsSummary: voidC.agreementsSummary,
            attendedAt,
            finalizedAt,
            voidedAt: finalizedAt,
            voidReason: "MOTIVO_INTERNO_FORCE_VOID",
            authorName: "Ana Pedagoga Alpha",
            authorRole: "Pedagoga",
            authorEmail: voidC.authorEmail,
            contentHash: voidC.hash,
            verificationCode: "FORCE-ATA-VOID-2",
          },
          {
            id: "fpub-ata-draft",
            schoolId: "force-pub-alpha",
            year: 2026,
            ataNumber: 3,
            status: "DRAFT",
            category: "ATENDIMENTO_FAMILIA",
            subject: draftC.subject,
            summary: draftC.summary,
            agreementsSummary: draftC.agreementsSummary,
            attendedAt,
            authorName: "Ana Pedagoga Alpha",
            authorRole: "Pedagoga",
            authorEmail: draftC.authorEmail,
            contentHash: draftC.hash,
            verificationCode: "FORCE-ATA-DRAFT-3",
          },
        ],
      });

      await adminPrisma.pedagogicalMinuteStudent.createMany({
        data: [
          { id: "fpub-ms-alpha", minuteId: "fpub-ata-alpha", studentId: "fpub-stu-alpha", studentNameSnapshot: "Aluno Force Alpha", classNameSnapshot: "6º Ano A", cgmSnapshot: "777111222" },
          { id: "fpub-ms-beta", minuteId: "fpub-ata-beta", studentId: "fpub-stu-beta", studentNameSnapshot: "Aluno Force Beta", classNameSnapshot: "6º Ano A", cgmSnapshot: "888111222" },
          { id: "fpub-ms-void", minuteId: "fpub-ata-void", studentId: "fpub-stu-alpha", studentNameSnapshot: "Aluno Force Alpha", classNameSnapshot: "6º Ano A", cgmSnapshot: "777111222" },
          { id: "fpub-ms-draft", minuteId: "fpub-ata-draft", studentId: "fpub-stu-alpha", studentNameSnapshot: "Aluno Force Alpha", classNameSnapshot: "6º Ano A", cgmSnapshot: "777111222" },
        ],
      });

      await adminPrisma.pedagogicalMinuteParticipant.createMany({
        data: [
          {
            id: "fpub-part-alpha",
            minuteId: "fpub-ata-alpha",
            role: "MOTHER",
            name: "Maria Force Alpha",
            documentType: "CPF",
            documentNumber: "12345678901",
            signatureMode: "DRAW",
            signatureData: alphaC.sigData,
            biometricStrokeData: alphaC.bioData,
            biometricVerified: true,
            verifiedEmail: "maria.force@escola.pr.gov.br",
            mobileSignToken: "TOKEN_FORCE_ALPHA",
          },
          {
            id: "fpub-part-beta",
            minuteId: "fpub-ata-beta",
            role: "MOTHER",
            name: "Joao Force Beta",
            documentType: "CPF",
            documentNumber: "98765432100",
            signatureMode: "DRAW",
            signatureData: betaC.sigData,
            biometricStrokeData: betaC.bioData,
            biometricVerified: true,
            verifiedEmail: "joao.force@escola.pr.gov.br",
            mobileSignToken: "TOKEN_FORCE_BETA",
          },
          {
            id: "fpub-part-void",
            minuteId: "fpub-ata-void",
            role: "MOTHER",
            name: "Maria Force Void",
            documentType: "CPF",
            documentNumber: "11122233344",
            signatureMode: "DRAW",
            signatureData: voidC.sigData,
            biometricStrokeData: voidC.bioData,
            biometricVerified: true,
            verifiedEmail: "void.force@escola.pr.gov.br",
            mobileSignToken: "TOKEN_FORCE_VOID",
          },
          {
            id: "fpub-part-draft",
            minuteId: "fpub-ata-draft",
            role: "MOTHER",
            name: "Maria Force Draft",
            documentType: "CPF",
            documentNumber: "55566677788",
            signatureMode: "DRAW",
            signatureData: draftC.sigData,
            biometricStrokeData: draftC.bioData,
            biometricVerified: true,
            verifiedEmail: "draft.force@escola.pr.gov.br",
            mobileSignToken: "TOKEN_FORCE_DRAFT",
          },
        ],
      });

      await adminPrisma.pedagogicalActionItem.createMany({
        data: [
          { id: "fpub-ai-alpha", minuteId: "fpub-ata-alpha", description: "Ação fpub-ata-alpha", responsible: "Equipe" },
          { id: "fpub-ai-beta", minuteId: "fpub-ata-beta", description: "Ação fpub-ata-beta", responsible: "Equipe" },
          { id: "fpub-ai-void", minuteId: "fpub-ata-void", description: "Ação fpub-ata-void", responsible: "Equipe" },
          { id: "fpub-ai-draft", minuteId: "fpub-ata-draft", description: "Ação fpub-ata-draft", responsible: "Equipe" },
        ],
      });

      await adminPrisma.pedagogicalMinuteAddendum.createMany({
        data: [
          {
            id: "fpub-add-alpha",
            minuteId: "fpub-ata-alpha",
            content: "Em tempo fpub-ata-alpha",
            authorName: "Ana Pedagoga Alpha",
            authorEmail: alphaC.authorEmail,
            previousHash: alphaC.hash,
            addendumHash: alphaC.addHash,
            createdAt: addendumCreatedAt,
          },
          {
            id: "fpub-add-beta",
            minuteId: "fpub-ata-beta",
            content: "Em tempo fpub-ata-beta",
            authorName: "Carlos Pedagogo Beta",
            authorEmail: betaC.authorEmail,
            previousHash: betaC.hash,
            addendumHash: betaC.addHash,
            createdAt: addendumCreatedAt,
          },
          {
            id: "fpub-add-void",
            minuteId: "fpub-ata-void",
            content: "Em tempo fpub-ata-void",
            authorName: "Ana Pedagoga Alpha",
            authorEmail: voidC.authorEmail,
            previousHash: voidC.hash,
            addendumHash: voidC.addHash,
            createdAt: addendumCreatedAt,
          },
        ],
      });
    });

    afterAll(async () => {
      if (prevSecDefEnv === undefined) delete process.env.RLS_PUBLIC_ATA_SECDEF_RESOLVER;
      else process.env.RLS_PUBLIC_ATA_SECDEF_RESOLVER = prevSecDefEnv;
      await runtimePrisma?.$disconnect().catch(() => {});
      await otherConsumerPrisma?.$disconnect().catch(() => {});
      await adminPrisma?.$disconnect().catch(() => {});
    });

    it("comprova current_user, session_user, atributos das roles, ENABLE/FORCE RLS, privilégios por coluna e bloqueio de SET ROLE", async () => {
      const identity = await runtimePrisma.$queryRaw<
        Array<{ current_user: string; session_user: string }>
      >`SELECT current_user::text, session_user::text`;
      expect(identity[0]).toEqual({ current_user: "app_runtime", session_user: "app_runtime" });

      const roles = await adminPrisma.$queryRaw<
        Array<{
          rolname: string;
          rolcanlogin: boolean;
          rolsuper: boolean;
          rolbypassrls: boolean;
        }>
      >`
        SELECT rolname, rolcanlogin, rolsuper, rolbypassrls
        FROM pg_roles
        WHERE rolname IN ('app_runtime', 'app_other_consumer', 'ata_public_lookup_owner')
        ORDER BY rolname ASC
      `;
      expect(roles).toEqual([
        { rolname: "app_other_consumer", rolcanlogin: true, rolsuper: false, rolbypassrls: false },
        { rolname: "app_runtime", rolcanlogin: true, rolsuper: false, rolbypassrls: false },
        { rolname: "ata_public_lookup_owner", rolcanlogin: false, rolsuper: false, rolbypassrls: false },
      ]);

      const rlsFlags = await adminPrisma.$queryRaw<
        Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>
      >`
        SELECT relname, relrowsecurity, relforcerowsecurity
        FROM pg_class
        WHERE relname IN (
          'PedagogicalMinute',
          'PedagogicalMinuteStudent',
          'PedagogicalMinuteParticipant',
          'PedagogicalActionItem',
          'PedagogicalMinuteAddendum'
        )
        ORDER BY relname ASC
      `;
      expect(rlsFlags).toHaveLength(5);
      expect(rlsFlags.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);

      const owners = await adminPrisma.$queryRaw<Array<{ tablename: string; tableowner: string }>>`
        SELECT tablename, tableowner
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN (
            'PedagogicalMinute',
            'PedagogicalMinuteStudent',
            'PedagogicalMinuteParticipant',
            'PedagogicalActionItem',
            'PedagogicalMinuteAddendum'
          )
      `;
      expect(owners.every((o) => o.tableowner !== "app_runtime" && o.tableowner !== "ata_public_lookup_owner")).toBe(true);

      const lookupCols = await adminPrisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name
        FROM information_schema.column_privileges
        WHERE grantee = 'ata_public_lookup_owner'
          AND table_schema = 'public'
          AND table_name = 'PedagogicalMinute'
          AND privilege_type = 'SELECT'
        ORDER BY column_name ASC
      `;
      expect(lookupCols.map((c) => c.column_name)).toEqual(["id", "schoolId", "verificationCode"]);

      await expect(
        runtimePrisma.$executeRawUnsafe(`SET ROLE ata_public_lookup_owner`)
      ).rejects.toThrow(/permission denied|42501/i);
    });

    it("comprova leitura direta bloqueada sem contexto, isolamento na escola A e recusa de EXECUTE para role sem permissão", async () => {
      const withoutContext = await runtimePrisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM public."PedagogicalMinute"
      `;
      expect(withoutContext).toHaveLength(0);

      const onlyAlpha = await withTenantContext(runtimePrisma, "force-pub-alpha", (tx) =>
        tx.$queryRaw<Array<{ id: string; schoolId: string }>>`
          SELECT "id", "schoolId" FROM public."PedagogicalMinute" ORDER BY "id" ASC
        `
      );
      expect(onlyAlpha.length).toBeGreaterThan(0);
      expect(onlyAlpha.every((r) => r.schoolId === "force-pub-alpha")).toBe(true);

      await expect(
        otherConsumerPrisma.$queryRaw`SELECT * FROM public.resolve_public_ata_by_code('FORCE-ATA-ALPHA-1')`
      ).rejects.toThrow(/permission denied|42501/i);
    });

    it("executa GET /api/atas/public/[code] e /validar/ata/[code] com app_runtime sob FORCE RLS e valida mudança entre resolução e releitura", async () => {
      const { cookies } = await import("next/headers");
      vi.mocked(logAudit).mockClear();

      // 1. Retorno mínimo da função SECURITY DEFINER
      const alphaLookup = await runtimePrisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT * FROM public.resolve_public_ata_by_code('FORCE-ATA-ALPHA-1')
      `;
      expect(alphaLookup).toEqual([{ id: "fpub-ata-alpha", schoolId: "force-pub-alpha" }]);
      expect(Object.keys(alphaLookup[0])).toEqual(["id", "schoolId"]);

      const betaLookup = await runtimePrisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT * FROM public.resolve_public_ata_by_code('FORCE-ATA-BETA-1')
      `;
      expect(betaLookup).toEqual([{ id: "fpub-ata-beta", schoolId: "force-pub-beta" }]);

      const missingLookup = await runtimePrisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT * FROM public.resolve_public_ata_by_code('FORCE-INEXISTENTE-999')
      `;
      expect(missingLookup).toEqual([]);

      // 2. Pontos de entrada da aplicação para Alpha, Beta, VOIDED, DRAFT e inexistente (ignorando cookie cruzado)
      vi.mocked(cookies).mockResolvedValue({
        get: (name: string) => (name === "active_school_id" ? { value: "force-pub-beta" } : undefined),
      } as never);

      const alphaApi = await getPublicAtaRoute(
        new Request("http://127.0.0.1/api/atas/public/force-ata-alpha-1"),
        { params: Promise.resolve({ code: "force-ata-alpha-1" }) }
      );
      expect(alphaApi.status).toBe(200);
      const alphaJson = await alphaApi.json();
      expect(alphaJson.data.isAuthentic).toBe(true);
      expect(alphaJson.data.school.name).toBe("Colégio Force Alpha");
      expect(JSON.stringify(alphaJson)).not.toContain("SIG_FORCE");
      expect(JSON.stringify(alphaJson)).not.toContain("TOKEN_FORCE");
      expect(JSON.stringify(alphaJson)).not.toContain("Relato Interno");

      const alphaSsr = renderToStaticMarkup(
        await ValidarAtaPage({ params: Promise.resolve({ code: "force-ata-alpha-1" }) })
      );
      expect(alphaSsr).toContain("Ata pedagógica íntegra");
      expect(alphaSsr).toContain("Colégio Force Alpha");

      const betaApi = await getPublicAtaRoute(
        new Request("http://127.0.0.1/api/atas/public/FORCE-ATA-BETA-1"),
        { params: Promise.resolve({ code: "FORCE-ATA-BETA-1" }) }
      );
      expect(betaApi.status).toBe(200);
      const betaJson = await betaApi.json();
      expect(betaJson.data.isAuthentic).toBe(true);
      expect(betaJson.data.school.name).toBe("Colégio Force Beta");

      const voidApi = await getPublicAtaRoute(
        new Request("http://127.0.0.1/api/atas/public/FORCE-ATA-VOID-2"),
        { params: Promise.resolve({ code: "FORCE-ATA-VOID-2" }) }
      );
      expect(voidApi.status).toBe(200);
      const voidJson = await voidApi.json();
      expect(voidJson.data.isAuthentic).toBe(true);
      expect(voidJson.data.isVoided).toBe(true);
      expect(JSON.stringify(voidJson)).not.toContain("MOTIVO_INTERNO_FORCE_VOID");
      expect(renderToStaticMarkup(
        await ValidarAtaPage({ params: Promise.resolve({ code: "FORCE-ATA-VOID-2" }) })
      )).toContain("Ata Tornada Sem Efeito");

      const draftApi = await getPublicAtaRoute(
        new Request("http://127.0.0.1/api/atas/public/FORCE-ATA-DRAFT-3"),
        { params: Promise.resolve({ code: "FORCE-ATA-DRAFT-3" }) }
      );
      expect(draftApi.status).toBe(200);
      const draftJson = await draftApi.json();
      expect(draftJson.data.minuteHashValid).toBe(true);
      expect(draftJson.data.isAuthentic).toBe(false);
      expect(renderToStaticMarkup(
        await ValidarAtaPage({ params: Promise.resolve({ code: "FORCE-ATA-DRAFT-3" }) })
      )).toContain("Violação de integridade detectada");

      const missingApi = await getPublicAtaRoute(
        new Request("http://127.0.0.1/api/atas/public/FORCE-INEXISTENTE-999"),
        { params: Promise.resolve({ code: "FORCE-INEXISTENTE-999" }) }
      );
      expect(missingApi.status).toBe(404);
      expect(renderToStaticMarkup(
        await ValidarAtaPage({ params: Promise.resolve({ code: "FORCE-INEXISTENTE-999" }) })
      )).toContain("Documento não encontrado");

      // 3. Regressão: alteração de código e de escola entre resolução e releitura
      const origQueryRaw = runtimePrisma.$queryRaw.bind(runtimePrisma);
      let tamperMode: "code" | "school" = "code";
      const querySpy = vi
        .spyOn(runtimePrisma, "$queryRaw")
        .mockImplementation((async (...args: unknown[]) => {
          const res = await (origQueryRaw as (...a: unknown[]) => Promise<unknown>)(...args);
          if (tamperMode === "code") {
            await adminPrisma.pedagogicalMinute.update({
              where: { id: "fpub-ata-alpha" },
              data: { verificationCode: "FORCE-ATA-ALPHA-MUTADO" },
            });
          } else {
            await adminPrisma.pedagogicalMinute.update({
              where: { id: "fpub-ata-alpha" },
              data: { schoolId: "force-pub-beta", ataNumber: 99 },
            });
          }
          return res;
        }) as never);

      try {
        tamperMode = "code";
        const codeTamperedRes = await getPublicAtaRoute(
          new Request("http://127.0.0.1/api/atas/public/FORCE-ATA-ALPHA-1"),
          { params: Promise.resolve({ code: "FORCE-ATA-ALPHA-1" }) }
        );
        expect(codeTamperedRes.status).toBe(404);

        await adminPrisma.pedagogicalMinute.update({
          where: { id: "fpub-ata-alpha" },
          data: { verificationCode: "FORCE-ATA-ALPHA-1", schoolId: "force-pub-alpha", ataNumber: 1 },
        });
        tamperMode = "school";
        const schoolTamperedRes = await getPublicAtaRoute(
          new Request("http://127.0.0.1/api/atas/public/FORCE-ATA-ALPHA-1"),
          { params: Promise.resolve({ code: "FORCE-ATA-ALPHA-1" }) }
        );
        expect(schoolTamperedRes.status).toBe(404);
      } finally {
        querySpy.mockRestore();
        await adminPrisma.pedagogicalMinute.update({
          where: { id: "fpub-ata-alpha" },
          data: { verificationCode: "FORCE-ATA-ALPHA-1", schoolId: "force-pub-alpha", ataNumber: 1 },
        });
        vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
      }

      expect(vi.mocked(logAudit)).not.toHaveBeenCalled();
    });

    it("comprova limpeza do contexto escolar na mesma conexão física (pg_backend_pid) após COMMIT e ROLLBACK", async () => {
      const txCommit = await withTenantContext(runtimePrisma, "force-pub-alpha", async (tx) => {
        const rows = await tx.$queryRaw<Array<{ pid: number; setting: string | null }>>`
          SELECT pg_backend_pid()::int AS pid, NULLIF(current_setting('app.current_school_id', true), '') AS setting
        `;
        return rows[0];
      });
      expect(txCommit.setting).toBe("force-pub-alpha");

      const postCommit = await runtimePrisma.$queryRaw<
        Array<{ pid: number; setting: string | null; count: bigint }>
      >`
        SELECT
          pg_backend_pid()::int AS pid,
          NULLIF(current_setting('app.current_school_id', true), '') AS setting,
          (SELECT COUNT(*) FROM public."PedagogicalMinute") AS count
      `;
      expect(postCommit[0].pid).toBe(txCommit.pid);
      expect(postCommit[0].setting).toBeNull();
      expect(postCommit[0].count).toBe(0n);

      let txRollbackPid = -1;
      await expect(
        withTenantContext(runtimePrisma, "force-pub-beta", async (tx) => {
          const rows = await tx.$queryRaw<Array<{ pid: number; setting: string | null }>>`
            SELECT pg_backend_pid()::int AS pid, NULLIF(current_setting('app.current_school_id', true), '') AS setting
          `;
          txRollbackPid = rows[0].pid;
          expect(rows[0].setting).toBe("force-pub-beta");
          throw new Error("FORCED_ROLLBACK_CHECK");
        })
      ).rejects.toThrow("FORCED_ROLLBACK_CHECK");

      const postRollback = await runtimePrisma.$queryRaw<
        Array<{ pid: number; setting: string | null; count: bigint }>
      >`
        SELECT
          pg_backend_pid()::int AS pid,
          NULLIF(current_setting('app.current_school_id', true), '') AS setting,
          (SELECT COUNT(*) FROM public."PedagogicalMinute") AS count
      `;
      expect(txRollbackPid).toBe(txCommit.pid);
      expect(postRollback[0].pid).toBe(txCommit.pid);
      expect(postRollback[0].setting).toBeNull();
      expect(postRollback[0].count).toBe(0n);
    });
  }
);
