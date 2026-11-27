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

    it("transferência legítima de estudante do diurno para o noturno com CGM compartilhado cria 1º 3 NOITE sem alterar turma diurna", async () => {
      const cgManha = await prisma.classGroup.create({
        data: { name: "1º 1", segment: "MEDIO", shift: "MANHA", schoolId: schoolAId },
      });
      await prisma.student.create({
        data: {
          cgm: "8000000001",
          name: "ESTUDANTE TRANSFERIDO",
          phone: "41999990001",
          classGroupId: cgManha.id,
          schoolId: schoolAId,
          active: true,
        },
      });

      const res = await importStudents(
        new Request("http://localhost/api/students/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            turmas: [
              {
                tempId: "t-noite",
                name: "1º 3",
                sourceIdentity: "NOTURNO|1ª SÉRIE|NOITE|3",
                segment: "NOTURNO",
                shift: "NOITE",
              },
            ],
            students: [
              {
                cgm: "8000000001",
                name: "ESTUDANTE TRANSFERIDO",
                phone: "41999990001",
                turmaTempId: "t-noite",
              },
            ],
            transferredStudents: [],
            options: { updateExisting: true, deactivateTransferred: true },
          }),
        })
      );
      expect(res.status).toBe(200);

      const cgManhaAfter = await prisma.classGroup.findUnique({ where: { id: cgManha.id } });
      expect(cgManhaAfter?.shift).toBe("MANHA");
      expect(cgManhaAfter?.segment).toBe("MEDIO");
      expect(cgManhaAfter?.name).toBe("1º 1");

      const cgNoite = await prisma.classGroup.findFirst({
        where: { schoolId: schoolAId, name: "1º 3" },
      });
      expect(cgNoite).not.toBeNull();
      expect(cgNoite?.id).not.toBe(cgManha.id);
      expect(cgNoite?.shift).toBe("NOITE");

      const st = await prisma.student.findUnique({ where: { cgm: "8000000001" } });
      expect(st?.classGroupId).toBe(cgNoite?.id);
    });

    it("importação legada (1º Série) e sequência renomear -> reimportar preservam o mesmo ClassGroup.id e vínculos", async () => {
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

      const resRename = await patchClass(
        new Request(`http://localhost/api/classes/${legacyCg.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "1º 3 Noturno" }),
        }),
        { params: Promise.resolve({ id: legacyCg.id }) }
      );
      expect(resRename.status).toBe(200);

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
      expect(totalA).toBe(2);
    });

    it("exige resolução explícita para reimportação sem alunos em comum / destinos ambíguos, preserva escola/dados em 400/409 e atualiza cadastro em lote válido", async () => {
      const cgRenamed = await prisma.classGroup.create({
        data: { name: "1º 3 Noturno", segment: "NOTURNO", shift: "NOITE", schoolId: schoolAId },
      });
      const cgForeign = await prisma.classGroup.create({
        data: { name: "1º 3", segment: "NOTURNO", shift: "NOITE", schoolId: schoolBId },
      });

      // SuperAdmin com updateSchoolInfo: true para testar atomicidade em 409, 400 e 200
      authContext.email = "super@redeativa.local";
      authContext.cookieSchoolId = schoolAId;
      authContext.explicitSchoolId = schoolAId;

      const basePayload = {
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
            name: "ESTUDANTE SEM COMUM",
            phone: "41999992001",
            turmaTempId: "t-1",
          },
        ],
        transferredStudents: [],
        options: {
          updateExisting: true,
          deactivateTransferred: true,
          updateSchoolInfo: true,
          schoolInfo: { name: "Escola Atualizada SERE", city: "Ponta Grossa" },
        },
      };

      // 1. Sem alunos em comum e turma existente "1º 3 Noturno" no mesmo turno -> 409 AMBIGUOUS_CLASS_GROUP
      const resAmbiguous = await importStudents(
        new Request("http://localhost/api/students/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(basePayload),
        })
      );
      expect(resAmbiguous.status).toBe(409);
      const bodyAmb = await resAmbiguous.json();
      expect(bodyAmb.code).toBe("AMBIGUOUS_CLASS_GROUP");
      const schoolAfter409 = await prisma.school.findUnique({ where: { id: schoolAId } });
      expect(schoolAfter409?.name).toBe("Escola Sintética A");
      expect(schoolAfter409?.city).toBe("Curitiba");
      expect(await prisma.student.count({ where: { schoolId: schoolAId } })).toBe(0);
      expect(await prisma.auditLog.count()).toBe(0);

      // 2. targetClassGroupId de outra escola -> 400 e zero efeito na escola/turmas/alunos/auditoria
      const resForeign = await importStudents(
        new Request("http://localhost/api/students/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...basePayload,
            turmas: [{ ...basePayload.turmas[0], targetClassGroupId: cgForeign.id }],
          }),
        })
      );
      expect(resForeign.status).toBe(400);
      const schoolAfter400 = await prisma.school.findUnique({ where: { id: schoolAId } });
      expect(schoolAfter400?.name).toBe("Escola Sintética A");
      expect(schoolAfter400?.city).toBe("Curitiba");
      expect(await prisma.student.count({ where: { schoolId: schoolAId } })).toBe(0);
      expect(await prisma.auditLog.count()).toBe(0);

      // 3. Seleção explícita válida (targetClassGroupId da escola ativa) -> 200 + atualiza cadastro da escola
      const resResolved = await importStudents(
        new Request("http://localhost/api/students/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...basePayload,
            turmas: [{ ...basePayload.turmas[0], targetClassGroupId: cgRenamed.id }],
          }),
        })
      );
      expect(resResolved.status).toBe(200);
      const st = await prisma.student.findUnique({ where: { cgm: "8200000001" } });
      expect(st?.classGroupId).toBe(cgRenamed.id);
      const schoolAfter200 = await prisma.school.findUnique({ where: { id: schoolAId } });
      expect(schoolAfter200?.name).toBe("Escola Atualizada SERE");
      expect(schoolAfter200?.city).toBe("Ponta Grossa");
      expect(await prisma.auditLog.count()).toBe(1);
    });

    it("bloqueia duplicidade canônica concorrente na mesma escola (409) e permite mesmo nome em escolas distintas", async () => {
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
      expect([res1.status, res2.status].sort()).toEqual([201, 409]);
      expect(await prisma.classGroup.count({ where: { schoolId: schoolAId } })).toBe(1);

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
      expect(await prisma.classGroup.count({ where: { schoolId: schoolAId } })).toBe(2);

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

    it("exige escrita na escola alvo em POST /api/classes e POST /api/students/import (403 e zero mutações)", async () => {
      const importPayload = {
        turmas: [{ tempId: "t-1", name: "3º 3", segment: "NOTURNO", shift: "NOITE" }],
        students: [{ cgm: "8400000001", name: "ALUNO TESTE RBAC", phone: "41999994001", turmaTempId: "t-1" }],
        transferredStudents: [],
        options: { updateExisting: true, deactivateTransferred: true },
      };

      // 1. Gestor de A com papel somente-leitura (GESTAO_SECRETARIA) em B -> 403 nos dois POSTs
      authContext.email = "gestor-a@escola.pr.gov.br";
      authContext.cookieSchoolId = schoolBId;
      authContext.explicitSchoolId = schoolBId;
      const rClassReadB = await postClass(
        new Request("http://localhost/api/classes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "3º 3", segment: "NOTURNO", shift: "NOITE" }),
        })
      );
      const rImportReadB = await importStudents(
        new Request("http://localhost/api/students/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(importPayload),
        })
      );
      expect(rClassReadB.status).toBe(403);
      expect(rImportReadB.status).toBe(403);

      // 2. SUPERADMIN sem seleção válida -> 403 nos dois POSTs
      authContext.email = "super@redeativa.local";
      authContext.cookieSchoolId = undefined;
      authContext.explicitSchoolId = undefined;
      const rClassSuperNoSchool = await postClass(
        new Request("http://localhost/api/classes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "3º 3", segment: "NOTURNO", shift: "NOITE" }),
        })
      );
      const rImportSuperNoSchool = await importStudents(
        new Request("http://localhost/api/students/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(importPayload),
        })
      );
      expect(rClassSuperNoSchool.status).toBe(403);
      expect(rImportSuperNoSchool.status).toBe(403);

      // 3. Vínculo revogado no banco -> 403 nos dois POSTs
      await prisma.userSchool.updateMany({
        where: { schoolId: schoolAId },
        data: { active: false },
      });
      authContext.email = "gestor-a@escola.pr.gov.br";
      authContext.cookieSchoolId = schoolAId;
      authContext.explicitSchoolId = schoolAId;
      const rClassRevoked = await postClass(
        new Request("http://localhost/api/classes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "3º 3", segment: "NOTURNO", shift: "NOITE" }),
        })
      );
      const rImportRevoked = await importStudents(
        new Request("http://localhost/api/students/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(importPayload),
        })
      );
      expect(rClassRevoked.status).toBe(403);
      expect(rImportRevoked.status).toBe(403);

      expect(await prisma.classGroup.count()).toBe(0);
      expect(await prisma.student.count()).toBe(0);
      expect(await prisma.auditLog.count()).toBe(0);
    });

    it("recusa edição em PATCH /api/classes/[id] com zero mutação e zero auditoria", async () => {
      const cgA = await prisma.classGroup.create({
        data: { name: "3º 3", segment: "NOTURNO", shift: "NOITE", schoolId: schoolAId },
      });
      const cgB = await prisma.classGroup.create({
        data: { name: "3º 3", segment: "NOTURNO", shift: "NOITE", schoolId: schoolBId },
      });

      authContext.email = "gestor-a@escola.pr.gov.br";
      authContext.cookieSchoolId = schoolBId;
      authContext.explicitSchoolId = schoolBId;
      expect(
        (
          await patchClass(
            new Request(`http://localhost/api/classes/${cgB.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: "3º 3 Alterado" }),
            }),
            { params: Promise.resolve({ id: cgB.id }) }
          )
        ).status
      ).toBe(403);

      authContext.email = "super@redeativa.local";
      authContext.cookieSchoolId = schoolBId;
      authContext.explicitSchoolId = schoolBId;
      expect(
        (
          await patchClass(
            new Request(`http://localhost/api/classes/${cgA.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: "3º 3 Alterado" }),
            }),
            { params: Promise.resolve({ id: cgA.id }) }
          )
        ).status
      ).toBe(404);

      authContext.cookieSchoolId = undefined;
      authContext.explicitSchoolId = undefined;
      expect(
        (
          await patchClass(
            new Request(`http://localhost/api/classes/${cgA.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: "3º 3 Alterado" }),
            }),
            { params: Promise.resolve({ id: cgA.id }) }
          )
        ).status
      ).toBe(403);

      await prisma.userSchool.updateMany({
        where: { schoolId: schoolAId },
        data: { active: false },
      });
      authContext.email = "gestor-a@escola.pr.gov.br";
      authContext.cookieSchoolId = schoolAId;
      authContext.explicitSchoolId = schoolAId;
      expect(
        (
          await patchClass(
            new Request(`http://localhost/api/classes/${cgA.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: "3º 3 Alterado" }),
            }),
            { params: Promise.resolve({ id: cgA.id }) }
          )
        ).status
      ).toBe(403);

      expect((await prisma.classGroup.findUnique({ where: { id: cgA.id } }))?.name).toBe("3º 3");
      expect((await prisma.classGroup.findUnique({ where: { id: cgB.id } }))?.name).toBe("3º 3");
      expect(await prisma.auditLog.count()).toBe(0);
    });
  }
);
