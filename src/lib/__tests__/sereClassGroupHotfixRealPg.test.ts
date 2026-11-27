import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const SHOULD_RUN = process.env.RUN_RLS_PHASE_A_TEST === "true";

function assertSafeLocalUrl(rawUrl: string | undefined): string {
  if (!rawUrl) {
    throw new Error("RLS_PHASE_A_DB_URL é obrigatório quando RUN_RLS_PHASE_A_TEST=true.");
  }
  const parsed = new URL(rawUrl);
  const host = parsed.hostname.toLowerCase();
  const dbName = parsed.pathname.replace(/^\//, "").toLowerCase();
  if ((host !== "127.0.0.1" && host !== "localhost") || !dbName.includes("rls_phase_a_test")) {
    throw new Error("URL recusada por segurança: exige host loopback e banco sintético rls_phase_a_test.");
  }
  return rawUrl;
}

const prismaRef = vi.hoisted(() => ({ current: null as unknown as PrismaClient }));
const authContext = vi.hoisted(() => ({
  email: "gestor-a@escola.pr.gov.br",
  cookieSchoolId: undefined as string | undefined,
  explicitSchoolId: undefined as string | null | undefined,
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === "active_school_id" && authContext.cookieSchoolId
        ? { value: authContext.cookieSchoolId }
        : undefined,
  })),
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, prop) {
        const client = prismaRef.current as unknown as Record<PropertyKey, unknown>;
        const val = client[prop];
        return typeof val === "function" ? val.bind(client) : val;
      },
    }
  ),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: {
      email: authContext.email,
      name: "Usuário Teste",
      active: true,
      schoolId: authContext.explicitSchoolId ?? undefined,
    },
  })),
}));

import { PATCH as patchClass } from "@/app/api/classes/[id]/route";
import { POST as postClass } from "@/app/api/classes/route";
import { POST as importStudents } from "@/app/api/students/import/route";
import { parseSereFiles, consolidateSelectedStudents } from "@/lib/sereParser";

describe.skipIf(!SHOULD_RUN)(
  "Hotfix Enturmação SERE Noturno + Edição & Concorrência de Turmas (PostgreSQL 16 Real)",
  () => {
    let prisma: PrismaClient;
    let schoolAId: string;
    let schoolBId: string;

    beforeAll(async () => {
      const url = assertSafeLocalUrl(process.env.RLS_PHASE_A_DB_URL);
      prisma = new PrismaClient({ datasources: { db: { url } } });
      prismaRef.current = prisma;
      await prisma.$connect();
    });

    afterAll(async () => {
      await prisma?.$disconnect();
    });

    beforeEach(async () => {
      await prisma.$executeRawUnsafe(
        'TRUNCATE TABLE "AuditLog", "Student", "ClassGroup", "UserSchool", "User", "School" RESTART IDENTITY CASCADE;'
      );

      const schoolA = await prisma.school.create({
        data: { name: "Escola Sintética A", inepCode: "99100001", city: "Curitiba", active: true },
      });
      const schoolB = await prisma.school.create({
        data: { name: "Escola Sintética B", inepCode: "99100002", city: "Londrina", active: true },
      });
      schoolAId = schoolA.id;
      schoolBId = schoolB.id;

      // Gestor de A com papel somente-leitura (GESTAO_SECRETARIA) em B
      const gestorA = await prisma.user.create({
        data: {
          email: "gestor-a@escola.pr.gov.br",
          name: "Gestor A",
          role: "GESTOR_ESCOLAR",
          active: true,
          schoolId: schoolAId,
        },
      });
      await prisma.userSchool.create({
        data: { userId: gestorA.id, schoolId: schoolAId, role: "GESTOR_ESCOLAR", active: true },
      });
      await prisma.userSchool.create({
        data: { userId: gestorA.id, schoolId: schoolBId, role: "GESTAO_SECRETARIA", active: true },
      });

      // SuperAdmin global
      await prisma.user.create({
        data: {
          email: "super@redeativa.local",
          name: "SuperAdmin",
          role: "SUPERADMIN",
          active: true,
        },
      });

      authContext.email = "gestor-a@escola.pr.gov.br";
      authContext.cookieSchoolId = schoolAId;
      authContext.explicitSchoolId = schoolAId;
    });

    it("importação legada (1º Série) e sequência renomear -> reimportar preservam o mesmo ClassGroup.id e vínculos", async () => {
      // 1. Turma legada no banco com nome "1º Série" no noturno
      const legacyCg = await prisma.classGroup.create({
        data: { name: "1º Série", segment: "NOTURNO", shift: "NOITE", schoolId: schoolAId },
      });

      const csv = [
        ",,GOVERNO DO ESTADO DO PARANÁ,,,,,,,,,,,,Data: 27/11/2026,,,,,",
        ',,"ESCOLA SINTETICA A",,,,,,,,,,,,2026,,,,,',
        ",RELAÇÃO DE ALUNOS POR TURMA,,,,,,,,,,,,,,,,,,",
        ",,Curso: ENSINO MEDIO,,,,Seriação: 1ª Série,,,,,,,Turno: Noite,,,Turma: 3 ,,,",
        ",,1,8100000001,ESTUDANTE NOTURNO UM,10/01/2009,,17,M,(41)99999-1001,,,,,Matriculado,,01/02/2026,,",
        ",,Curso: ENS FUND 6/9 ANO-SERIE,,,,Seriação: 6ºAno,,,,,,,Turno: Manhã,,,Turma: 1 ,,,",
        ",,1,8100000002,ESTUDANTE MANHA UM,10/01/2014,,12,M,(41)99999-1002,,,,,Matriculado,,01/02/2026,,",
      ].join("\n");

      const parsed = parseSereFiles([{ fileName: "sere.csv", content: csv }]);
      expect(parsed.turmas.map((t) => t.suggestedName)).toEqual(["1º 3", "6º 1"]);

      const consolidated = consolidateSelectedStudents(parsed, {}, {
        includeSemFrequencia: true,
        includeConcluinte: true,
      });

      // 2. Reimportação SERE sobre turma legada "1º Série" -> reutiliza legacyCg.id
      const resImport1 = await importStudents(
        new Request("http://localhost/api/students/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            turmas: consolidated.turmasToImport,
            students: consolidated.studentsToImport,
            transferredStudents: [],
            options: { updateExisting: true, deactivateTransferred: true },
          }),
        })
      );
      expect(resImport1.status).toBe(200);

      const st1Before = await prisma.student.findUnique({ where: { cgm: "8100000001" } });
      expect(st1Before?.classGroupId).toBe(legacyCg.id);

      // 3. Renomear "1º Série" para "1º 3 Noturno" via PATCH /api/classes/[id]
      const resRename = await patchClass(
        new Request(`http://localhost/api/classes/${legacyCg.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "1º 3 Noturno" }),
        }),
        { params: Promise.resolve({ id: legacyCg.id }) }
      );
      expect(resRename.status).toBe(200);
      const renameJson = await resRename.json();
      expect(renameJson.classGroup).toMatchObject({
        id: legacyCg.id,
        name: "1º 3 Noturno",
        shift: "NOITE",
        segment: "NOTURNO",
      });

      // 4. Reimportação SERE após renomear -> continua reutilizando legacyCg.id e preserva "1º 3 Noturno" e o vínculo do estudante
      const resImport2 = await importStudents(
        new Request("http://localhost/api/students/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            turmas: consolidated.turmasToImport,
            students: consolidated.studentsToImport,
            transferredStudents: [],
            options: { updateExisting: true, deactivateTransferred: true },
          }),
        })
      );
      expect(resImport2.status).toBe(200);

      const cgAfter = await prisma.classGroup.findUnique({ where: { id: legacyCg.id } });
      const st1After = await prisma.student.findUnique({ where: { cgm: "8100000001" } });
      const totalA = await prisma.classGroup.count({ where: { schoolId: schoolAId } });
      expect(cgAfter?.name).toBe("1º 3 Noturno");
      expect(st1After?.id).toBe(st1Before?.id);
      expect(st1After?.classGroupId).toBe(legacyCg.id);
      expect(totalA).toBe(2); // "1º 3 Noturno" + "6º 1"
    });

    it("recusa caso ambíguo sem resolução (409), valida targetClassGroupId na escola ativa e aceita após seleção explícita", async () => {
      const cg1 = await prisma.classGroup.create({
        data: { name: "1º Série", segment: "NOTURNO", shift: "NOITE", schoolId: schoolAId },
      });
      const cg2 = await prisma.classGroup.create({
        data: { name: "1º 3 Noturno", segment: "NOTURNO", shift: "NOITE", schoolId: schoolAId },
      });
      const cgForeign = await prisma.classGroup.create({
        data: { name: "1º 3", segment: "NOTURNO", shift: "NOITE", schoolId: schoolBId },
      });

      const payloadBase = {
        turmas: [
          {
            tempId: "t-1",
            name: "1º 3",
            sourceIdentity: "NOTURNO|1ª SÉRIE|NOITE|3",
            segment: "NOTURNO",
            shift: "NOITE",
          },
        ],
        students: [
          {
            cgm: "8200000001",
            name: "ESTUDANTE AMBIGUO",
            phone: "41999992001",
            turmaTempId: "t-1",
          },
        ],
        transferredStudents: [],
        options: { updateExisting: true, deactivateTransferred: true },
      };

      // Sem seleção explícita -> 409 AMBIGUOUS_CLASS_GROUP e zero mutação
      const resAmbiguous = await importStudents(
        new Request("http://localhost/api/students/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payloadBase),
        })
      );
      expect(resAmbiguous.status).toBe(409);
      const bodyAmb = await resAmbiguous.json();
      expect(bodyAmb.code).toBe("AMBIGUOUS_CLASS_GROUP");
      expect(await prisma.student.count({ where: { schoolId: schoolAId } })).toBe(0);
      expect(await prisma.classGroup.count({ where: { schoolId: schoolAId } })).toBe(2);

      // targetClassGroupId de outra escola -> 400
      const resForeign = await importStudents(
        new Request("http://localhost/api/students/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payloadBase,
            turmas: [{ ...payloadBase.turmas[0], targetClassGroupId: cgForeign.id }],
          }),
        })
      );
      expect(resForeign.status).toBe(400);
      expect(await prisma.student.count({ where: { schoolId: schoolAId } })).toBe(0);

      // targetClassGroupId válido na escola ativa -> 200 reutilizando cg2.id
      const resResolved = await importStudents(
        new Request("http://localhost/api/students/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payloadBase,
            turmas: [{ ...payloadBase.turmas[0], targetClassGroupId: cg2.id }],
          }),
        })
      );
      expect(resResolved.status).toBe(200);
      const st = await prisma.student.findUnique({ where: { cgm: "8200000001" } });
      expect(st?.classGroupId).toBe(cg2.id);
      expect(cg1.id).not.toBe(cg2.id);
    });

    it("bloqueia duplicidade canônica concorrente na mesma escola (409) e permite mesmo nome em escolas distintas", async () => {
      // Duas criações simultâneas com nomes canonicamente equivalentes na Escola A
      const [res1, res2] = await Promise.all([
        postClass(
          new Request("http://localhost/api/classes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "1º 3", segment: "MEDIO", shift: "NOITE" }),
          })
        ),
        postClass(
          new Request("http://localhost/api/classes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "1° 3", segment: "MEDIO", shift: "NOITE" }),
          })
        ),
      ]);
      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([201, 409]);
      expect(await prisma.classGroup.count({ where: { schoolId: schoolAId } })).toBe(1);

      // Criação vs importação disputando "2º 3" vs "2° 3" na mesma escola -> no máximo 1 turma criada
      const [resCreate2, resImport2] = await Promise.all([
        postClass(
          new Request("http://localhost/api/classes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "2º 3", segment: "MEDIO", shift: "NOITE" }),
          })
        ),
        importStudents(
          new Request("http://localhost/api/students/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              turmas: [{ tempId: "t-2", name: "2° 3", segment: "MEDIO", shift: "NOITE" }],
              students: [
                { cgm: "8300000001", name: "ALUNO CONCORRENTE", phone: "41999993001", turmaTempId: "t-2" },
              ],
              transferredStudents: [],
              options: { updateExisting: true, deactivateTransferred: true },
            }),
          })
        ),
      ]);
      expect([resCreate2.status, resImport2.status]).not.toContain(500);
      const classesA = await prisma.classGroup.findMany({ where: { schoolId: schoolAId } });
      expect(classesA.length).toBe(2); // "1º 3" + apenas uma "2º 3"/"2° 3"

      // Escola B pode usar "1º 3" normalmente (201)
      authContext.email = "super@redeativa.local";
      authContext.cookieSchoolId = schoolBId;
      authContext.explicitSchoolId = schoolBId;
      const resB = await postClass(
        new Request("http://localhost/api/classes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "1º 3", segment: "MEDIO", shift: "NOITE" }),
        })
      );
      expect(resB.status).toBe(201);
    });

    it("recusa edição com zero mutação e zero auditoria para vínculo revogado, papel leitura em B e SUPERADMIN com outra escola selecionada", async () => {
      const cgA = await prisma.classGroup.create({
        data: { name: "3º 3", segment: "NOTURNO", shift: "NOITE", schoolId: schoolAId },
      });
      const cgB = await prisma.classGroup.create({
        data: { name: "3º 3", segment: "NOTURNO", shift: "NOITE", schoolId: schoolBId },
      });

      // 1. Gestor de A com papel somente-leitura (GESTAO_SECRETARIA) em B tentando editar turma de B -> 403
      authContext.email = "gestor-a@escola.pr.gov.br";
      authContext.cookieSchoolId = schoolBId;
      authContext.explicitSchoolId = schoolBId;
      const resReadOnlyB = await patchClass(
        new Request(`http://localhost/api/classes/${cgB.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "3º 3 Alterado" }),
        }),
        { params: Promise.resolve({ id: cgB.id }) }
      );
      expect(resReadOnlyB.status).toBe(403);

      // 2. SUPERADMIN com escola B selecionada tentando editar turma de escola A -> 404
      authContext.email = "super@redeativa.local";
      authContext.cookieSchoolId = schoolBId;
      authContext.explicitSchoolId = schoolBId;
      const resSuperWrongSchool = await patchClass(
        new Request(`http://localhost/api/classes/${cgA.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "3º 3 Alterado" }),
        }),
        { params: Promise.resolve({ id: cgA.id }) }
      );
      expect(resSuperWrongSchool.status).toBe(404);

      // 3. SUPERADMIN sem escola selecionada -> 403
      authContext.cookieSchoolId = undefined;
      authContext.explicitSchoolId = undefined;
      const resSuperNoSchool = await patchClass(
        new Request(`http://localhost/api/classes/${cgA.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "3º 3 Alterado" }),
        }),
        { params: Promise.resolve({ id: cgA.id }) }
      );
      expect(resSuperNoSchool.status).toBe(403);

      // 4. Revogação do vínculo do Gestor A no banco -> 403
      await prisma.userSchool.updateMany({
        where: { schoolId: schoolAId },
        data: { active: false },
      });
      authContext.email = "gestor-a@escola.pr.gov.br";
      authContext.cookieSchoolId = schoolAId;
      authContext.explicitSchoolId = schoolAId;
      const resRevoked = await patchClass(
        new Request(`http://localhost/api/classes/${cgA.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "3º 3 Alterado" }),
        }),
        { params: Promise.resolve({ id: cgA.id }) }
      );
      expect(resRevoked.status).toBe(403);

      // Comprova zero mutação e zero auditoria em todas as recusas
      const cgAAfter = await prisma.classGroup.findUnique({ where: { id: cgA.id } });
      const cgBAfter = await prisma.classGroup.findUnique({ where: { id: cgB.id } });
      const auditCount = await prisma.auditLog.count();
      expect(cgAAfter?.name).toBe("3º 3");
      expect(cgBAfter?.name).toBe("3º 3");
      expect(auditCount).toBe(0);
    });
  }
);
