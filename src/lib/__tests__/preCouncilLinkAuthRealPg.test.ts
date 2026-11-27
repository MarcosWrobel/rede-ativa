import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const realPgUrl = process.env.REAL_PG_TEST_URL?.trim() || "";

const hoisted = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  cookieSchoolId: null as string | null,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => hoisted.session),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === "active_school_id" && hoisted.cookieSchoolId
        ? { value: hoisted.cookieSchoolId }
        : undefined,
  })),
}));

import { prisma } from "@/lib/prisma";
import { createCouncilTeacherToken } from "@/lib/councilTeacherToken";
import { POST as postTeacherLinkRoute } from "@/app/api/conselho-classe/[boardId]/teacher-link/route";
import {
  POST as postTeacherPortalRoute,
  PUT as putTeacherPortalRoute,
} from "@/app/api/conselho-classe/teacher-portal/[token]/route";

describe.skipIf(!realPgUrl)(
  "Pré-Conselho: autorização de link e portal docente em PostgreSQL 16 isolado",
  () => {
    const prevDevAuth = process.env.ENABLE_DEV_AUTH;

    beforeAll(async () => {
      process.env.ENABLE_DEV_AUTH = "true";
    });

    afterAll(async () => {
      if (prevDevAuth === undefined) delete process.env.ENABLE_DEV_AUTH;
      else process.env.ENABLE_DEV_AUTH = prevDevAuth;
      await prisma.$disconnect();
    });

    beforeEach(async () => {
      hoisted.session = null;
      hoisted.cookieSchoolId = null;

      await prisma.studentCouncilSubjectEntry.deleteMany({
        where: { schoolId: { in: ["pg-school-a", "pg-school-b"] } },
      });
      await prisma.studentCouncilCard.deleteMany({
        where: { schoolId: { in: ["pg-school-a", "pg-school-b"] } },
      });
      await prisma.classCouncilTrimester.deleteMany({
        where: { schoolId: { in: ["pg-school-a", "pg-school-b"] } },
      });
      await prisma.classCouncilSubject.deleteMany({
        where: { schoolId: { in: ["pg-school-a", "pg-school-b"] } },
      });
      await prisma.classCouncilBoard.deleteMany({
        where: { schoolId: { in: ["pg-school-a", "pg-school-b"] } },
      });
      await prisma.student.deleteMany({
        where: { schoolId: { in: ["pg-school-a", "pg-school-b"] } },
      });
      await prisma.classGroup.deleteMany({
        where: { schoolId: { in: ["pg-school-a", "pg-school-b"] } },
      });
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { schoolId: { in: ["pg-school-a", "pg-school-b"] } },
            { userId: "pg-super" },
          ],
        },
      });
      await prisma.user.deleteMany({ where: { id: { in: ["pg-super", "pg-dual-role"] } } });
      await prisma.school.deleteMany({
        where: { id: { in: ["pg-school-a", "pg-school-b"] } },
      });

      await prisma.user.create({
        data: {
          id: "pg-super",
          name: "Super Admin",
          email: "super@redeativa.app.br",
          role: "SUPERADMIN",
          active: true,
        },
      });

      await prisma.school.createMany({
        data: [
          {
            id: "pg-school-a",
            inepCode: "41990001",
            name: "Escola Sintética Alpha",
            city: "Curitiba",
            state: "PR",
            nre: "Curitiba",
            network: "ESTADUAL",
            active: true,
          },
          {
            id: "pg-school-b",
            inepCode: "41990002",
            name: "Escola Sintética Beta",
            city: "Curitiba",
            state: "PR",
            nre: "Curitiba",
            network: "ESTADUAL",
            active: true,
          },
        ],
      });

      await prisma.classGroup.createMany({
        data: [
          {
            id: "pg-cg-a",
            schoolId: "pg-school-a",
            name: "7º Ano A",
            segment: "FUNDAMENTAL",
            shift: "MANHA",
          },
          {
            id: "pg-cg-b",
            schoolId: "pg-school-b",
            name: "8º Ano B",
            segment: "FUNDAMENTAL",
            shift: "TARDE",
          },
        ],
      });

      await prisma.student.createMany({
        data: [
          {
            id: "pg-stu-a1",
            schoolId: "pg-school-a",
            classGroupId: "pg-cg-a",
            name: "Estudante Sintético Alpha 1",
            cgm: "900001",
            phone: "41000000001",
            active: true,
          },
          {
            id: "pg-stu-b1",
            schoolId: "pg-school-b",
            classGroupId: "pg-cg-b",
            name: "Estudante Sintético Beta 1",
            cgm: "900002",
            phone: "41000000002",
            active: true,
          },
        ],
      });

      await prisma.classCouncilBoard.createMany({
        data: [
          {
            id: "pg-board-a",
            schoolId: "pg-school-a",
            classGroupId: "pg-cg-a",
            year: 2026,
          },
          {
            id: "pg-board-b",
            schoolId: "pg-school-b",
            classGroupId: "pg-cg-b",
            year: 2026,
          },
        ],
      });

      await prisma.classCouncilSubject.createMany({
        data: [
          {
            id: "pg-subj-a-assigned",
            schoolId: "pg-school-a",
            boardId: "pg-board-a",
            name: "Matemática",
            teacherName: "Prof. Alpha",
            teacherEmail: "docente.alpha@escola.pr.gov.br",
            displayOrder: 0,
            active: true,
          },
          {
            id: "pg-subj-a-other",
            schoolId: "pg-school-a",
            boardId: "pg-board-a",
            name: "História",
            teacherName: "Prof. Outro",
            teacherEmail: "docente.outro@escola.pr.gov.br",
            displayOrder: 1,
            active: true,
          },
          {
            id: "pg-subj-a-unassigned",
            schoolId: "pg-school-a",
            boardId: "pg-board-a",
            name: "Artes",
            teacherName: null,
            teacherEmail: null,
            displayOrder: 2,
            active: true,
          },
          {
            id: "pg-subj-b-assigned",
            schoolId: "pg-school-b",
            boardId: "pg-board-b",
            name: "Geografia",
            teacherName: "Prof. Beta",
            teacherEmail: "docente.beta@escola.pr.gov.br",
            displayOrder: 0,
            active: true,
          },
        ],
      });
    });

    it("valida emissão autorizada, posse estrita do SUPERADMIN, tentativa cruzada, token expirado, docente de outra escola e conta sem atribuição sem vazar dados ou mutar o banco", async () => {
      // 1. SUPERADMIN sem escola selecionada recebe 403 e não grava auditoria
      hoisted.session = {
        user: {
          id: "pg-super",
          name: "Super Admin",
          email: "super@redeativa.app.br",
          role: "SUPERADMIN",
          active: true,
          schoolId: null,
          schools: [],
        },
      };
      const noSchoolRes = await postTeacherLinkRoute(
        new Request("https://www.redeativa.app.br/api/conselho-classe/pg-board-a/teacher-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trimester: 1, subjectId: "pg-subj-a-assigned" }),
        }),
        { params: Promise.resolve({ boardId: "pg-board-a" }) }
      );
      const schoolScope = { where: { schoolId: { in: ["pg-school-a", "pg-school-b"] } } };
      expect(noSchoolRes.status).toBe(403);
      expect(await prisma.auditLog.count(schoolScope)).toBe(0);

      // 2. SUPERADMIN com pg-school-b selecionada tentando emitir para pg-board-a recebe 403
      hoisted.cookieSchoolId = "pg-school-b";
      const wrongSchoolRes = await postTeacherLinkRoute(
        new Request("https://www.redeativa.app.br/api/conselho-classe/pg-board-a/teacher-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trimester: 1, subjectId: "pg-subj-a-assigned" }),
        }),
        { params: Promise.resolve({ boardId: "pg-board-a" }) }
      );
      expect(wrongSchoolRes.status).toBe(403);
      expect(await prisma.auditLog.count(schoolScope)).toBe(0);

      // 3. Emissão autorizada para pg-school-a (com seleção explícita)
      hoisted.cookieSchoolId = "pg-school-a";
      const okLinkRes = await postTeacherLinkRoute(
        new Request("https://www.redeativa.app.br/api/conselho-classe/pg-board-a/teacher-link", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            host: "www.redeativa.app.br",
            "x-forwarded-proto": "https",
          },
          body: JSON.stringify({ trimester: 1, subjectId: null, expiresInDays: 7 }),
        }),
        { params: Promise.resolve({ boardId: "pg-board-a" }) }
      );
      expect(okLinkRes.status).toBe(200);
      const okLinkBody = await okLinkRes.json();
      const issuedToken = decodeURIComponent(String(okLinkBody.url).split("/").pop() || "");
      expect(await prisma.auditLog.count({ where: { action: "CREATE_COUNCIL_TEACHER_LINK" } })).toBe(1);

      // 4. Tentativa cruzada: componente de outra escola no POST teacher-link
      const crossSubjRes = await postTeacherLinkRoute(
        new Request("https://www.redeativa.app.br/api/conselho-classe/pg-board-a/teacher-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trimester: 1, subjectId: "pg-subj-b-assigned" }),
        }),
        { params: Promise.resolve({ boardId: "pg-board-a" }) }
      );
      expect(crossSubjRes.status).toBe(404);

      // 5. Token expirado -> 401 sem dados estudantis nem mutações
      const expired = createCouncilTeacherToken({
        schoolId: "pg-school-a",
        boardId: "pg-board-a",
        trimester: 1,
        subjectId: "pg-subj-a-assigned",
        nowMs: Date.now() - 10 * 86_400_000,
        expiresInDays: 1,
      });
      const expiredPost = await postTeacherPortalRoute(
        new Request(`https://www.redeativa.app.br/api/conselho-classe/teacher-portal/${expired.token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ googleIdToken: "dev-mock-token:docente.alpha@escola.pr.gov.br" }),
        }),
        { params: Promise.resolve({ token: expired.token }) }
      );
      expect(expiredPost.status).toBe(401);
      expect(JSON.stringify(await expiredPost.json())).not.toContain("Estudante Sintético");

      const expiredPut = await putTeacherPortalRoute(
        new Request(`https://www.redeativa.app.br/api/conselho-classe/teacher-portal/${expired.token}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "dev-mock-token:docente.alpha@escola.pr.gov.br",
            subjectId: "pg-subj-a-assigned",
            entries: [{ studentId: "pg-stu-a1", descriptorCodes: [1] }],
          }),
        }),
        { params: Promise.resolve({ token: expired.token }) }
      );
      expect(expiredPut.status).toBe(401);
      expect(JSON.stringify(await expiredPut.json())).not.toContain("Estudante Sintético");
      expect(await prisma.classCouncilTrimester.count(schoolScope)).toBe(0);
      expect(await prisma.studentCouncilCard.count(schoolScope)).toBe(0);
      expect(await prisma.studentCouncilSubjectEntry.count(schoolScope)).toBe(0);

      // 6. Docente de outra escola (POST e PUT) -> 403 sem dados estudantis nem mutações
      const otherSchoolTeacherPost = await postTeacherPortalRoute(
        new Request(`https://www.redeativa.app.br/api/conselho-classe/teacher-portal/${issuedToken}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ googleIdToken: "dev-mock-token:docente.beta@escola.pr.gov.br" }),
        }),
        { params: Promise.resolve({ token: issuedToken }) }
      );
      expect(otherSchoolTeacherPost.status).toBe(403);
      expect(JSON.stringify(await otherSchoolTeacherPost.json())).not.toContain("Estudante Sintético");

      const otherSchoolTeacherPut = await putTeacherPortalRoute(
        new Request(`https://www.redeativa.app.br/api/conselho-classe/teacher-portal/${issuedToken}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "dev-mock-token:docente.beta@escola.pr.gov.br",
            subjectId: "pg-subj-a-assigned",
            entries: [{ studentId: "pg-stu-a1", descriptorCodes: [1] }],
          }),
        }),
        { params: Promise.resolve({ token: issuedToken }) }
      );
      expect(otherSchoolTeacherPut.status).toBe(403);
      const deniedBody = await otherSchoolTeacherPut.text();
      expect(deniedBody).not.toContain("Estudante Sintético");
      expect(deniedBody).not.toContain("Prof. Alpha");
      expect(deniedBody).not.toContain("docente.alpha@escola.pr.gov.br");
      expect(await prisma.classCouncilTrimester.count(schoolScope)).toBe(0);
      expect(await prisma.studentCouncilCard.count(schoolScope)).toBe(0);
      expect(await prisma.studentCouncilSubjectEntry.count(schoolScope)).toBe(0);

      // 7. Conta institucional @escola.pr.gov.br sem atribuição -> 403 sem dados estudantis nem mutações
      const unassignedPost = await postTeacherPortalRoute(
        new Request(`https://www.redeativa.app.br/api/conselho-classe/teacher-portal/${issuedToken}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ googleIdToken: "dev-mock-token:sem.atribuicao@escola.pr.gov.br" }),
        }),
        { params: Promise.resolve({ token: issuedToken }) }
      );
      expect(unassignedPost.status).toBe(403);
      expect(JSON.stringify(await unassignedPost.json())).not.toContain("Estudante Sintético");
      expect(await prisma.classCouncilTrimester.count(schoolScope)).toBe(0);
      expect(await prisma.studentCouncilCard.count(schoolScope)).toBe(0);

      const unassignedPut = await putTeacherPortalRoute(
        new Request(`https://www.redeativa.app.br/api/conselho-classe/teacher-portal/${issuedToken}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "dev-mock-token:sem.atribuicao@escola.pr.gov.br",
            subjectId: "pg-subj-a-unassigned",
            entries: [{ studentId: "pg-stu-a1", descriptorCodes: [1] }],
          }),
        }),
        { params: Promise.resolve({ token: issuedToken }) }
      );
      expect(unassignedPut.status).toBe(403);
      expect(await prisma.studentCouncilSubjectEntry.count()).toBe(0);
      expect(await prisma.classCouncilTrimester.count(schoolScope)).toBe(0);
      expect(await prisma.studentCouncilCard.count(schoolScope)).toBe(0);

      // 8. Docente atribuído no link de turma inteira recebe SOMENTE seu componente autorizado e grava atomicamente
      const authorizedPost = await postTeacherPortalRoute(
        new Request(`https://www.redeativa.app.br/api/conselho-classe/teacher-portal/${issuedToken}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ googleIdToken: "dev-mock-token:docente.alpha@escola.pr.gov.br" }),
        }),
        { params: Promise.resolve({ token: issuedToken }) }
      );
      expect(authorizedPost.status).toBe(200);
      const authBody = await authorizedPost.json();
      expect(authBody.council.subjects.map((s: { id: string }) => s.id)).toEqual([
        "pg-subj-a-assigned",
      ]);
      expect(authBody.council.students.map((s: { studentId: string }) => s.studentId)).toEqual([
        "pg-stu-a1",
      ]);

      const authorizedPut = await putTeacherPortalRoute(
        new Request(`https://www.redeativa.app.br/api/conselho-classe/teacher-portal/${issuedToken}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "dev-mock-token:docente.alpha@escola.pr.gov.br",
            subjectId: "pg-subj-a-assigned",
            entries: [{ studentId: "pg-stu-a1", descriptorCodes: [2] }],
            preCouncil: {
              monitoredStudentIds: ["pg-stu-a1"],
              monitoredStudentsNotes: "Acompanhamento sintético em matemática",
            },
          }),
        }),
        { params: Promise.resolve({ token: issuedToken }) }
      );
      expect(authorizedPut.status).toBe(200);
      expect(await prisma.studentCouncilSubjectEntry.count({ where: { schoolId: "pg-school-a" } })).toBe(1);
    });

    it("revalida o papel e o vínculo do emissor na escola selecionada", async () => {
      const email = "gestora.dupla@escola.pr.gov.br";
      await prisma.user.create({
        data: {
          id: "pg-dual-role",
          name: "Gestora de duas escolas",
          email,
          active: true,
          role: "GESTOR_ESCOLAR",
          schoolId: "pg-school-a",
          schools: {
            create: [
              { schoolId: "pg-school-a", role: "GESTOR_ESCOLAR" },
              { schoolId: "pg-school-b", role: "PROFESSOR" },
            ],
          },
        },
      });
      hoisted.session = {
        user: {
          id: "pg-dual-role",
          email,
          role: "GESTOR_ESCOLAR",
          active: true,
          schoolId: "pg-school-a",
          schools: [
            { schoolId: "pg-school-a", role: "GESTOR_ESCOLAR", active: true },
            { schoolId: "pg-school-b", role: "GESTOR_ESCOLAR", active: true },
          ],
        },
      };

      const issue = (boardId: string) => postTeacherLinkRoute(
        new Request(`https://www.redeativa.app.br/api/conselho-classe/${boardId}/teacher-link`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trimester: 1 }),
        }),
        { params: Promise.resolve({ boardId }) }
      );
      const auditWhere = { userId: "pg-dual-role", action: "CREATE_COUNCIL_TEACHER_LINK" };

      hoisted.cookieSchoolId = "pg-school-b";
      const denied = await issue("pg-board-b");
      expect(denied.status).toBe(403);
      expect(await denied.json()).not.toHaveProperty("url");
      expect(await prisma.auditLog.count({ where: auditWhere })).toBe(0);

      hoisted.cookieSchoolId = "pg-school-a";
      expect((await issue("pg-board-a")).status).toBe(200);
      expect(await prisma.auditLog.count({ where: auditWhere })).toBe(1);
      await prisma.userSchool.update({
        where: { userId_schoolId: { userId: "pg-dual-role", schoolId: "pg-school-a" } },
        data: { active: false },
      });
      expect((await issue("pg-board-a")).status).toBe(403);
      expect(await prisma.auditLog.count({ where: auditWhere })).toBe(1);
    });

    it("recusa atribuição de conversa com o mesmo nome e subjectId de outro componente", async () => {
      const email = "docente.outro@escola.pr.gov.br";
      const preCouncilJson = JSON.stringify({
        version: 1,
        conversations: [{
          id: "pg-conv-wrong-subject",
          subjectId: "pg-subj-a-other",
          subjectName: "Artes",
          teacherEmail: email,
          monitoredStudentsNotes: "Conversa privada do outro componente",
        }],
      });
      await prisma.classCouncilTrimester.create({
        data: { schoolId: "pg-school-a", boardId: "pg-board-a", trimester: 1, preCouncilJson },
      });
      const { token } = createCouncilTeacherToken({
        schoolId: "pg-school-a",
        boardId: "pg-board-a",
        trimester: 1,
        subjectId: "pg-subj-a-unassigned",
        expiresInDays: 1,
      });
      const params = Promise.resolve({ token });
      const req = (method: string, body: object) => new Request(
        `https://www.redeativa.app.br/api/conselho-classe/teacher-portal/${token}`,
        {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ googleIdToken: `dev-mock-token:${email}`, ...body }),
        }
      );

      const post = await postTeacherPortalRoute(req("POST", {}), { params });
      expect(post.status).toBe(403);
      expect(await post.text()).not.toContain("Conversa privada do outro componente");
      const put = await putTeacherPortalRoute(req("PUT", {
        subjectId: "pg-subj-a-unassigned",
        entries: [{ studentId: "pg-stu-a1", descriptorCodes: [1] }],
      }), { params });
      expect(put.status).toBe(403);
      expect(await prisma.studentCouncilCard.count({ where: { boardId: "pg-board-a" } })).toBe(0);
      expect(await prisma.studentCouncilSubjectEntry.count({ where: { schoolId: "pg-school-a" } })).toBe(0);
      expect(await prisma.classCouncilTrimester.findMany({
        where: { boardId: "pg-board-a" },
        select: { preCouncilJson: true },
      })).toEqual([{ preCouncilJson }]);
    });
  }
);
