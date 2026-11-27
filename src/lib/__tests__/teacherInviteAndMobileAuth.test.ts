import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSchoolTeacherInviteToken,
  createTeacherInviteRecord,
  isSchoolTeacherInviteActive,
  mergeSchoolTeacherInviteSettings,
  parseSchoolTeacherInviteSettings,
  verifySchoolTeacherInviteCode,
  verifySchoolTeacherInviteToken,
} from "@/lib/schoolTeacherInvite";
import {
  getSafeGsiButtonWidth,
  isInAppWebViewUserAgent,
  isMobileBrowserUserAgent,
} from "@/lib/googleGsiMobile";
import { isSafeTeacherPortalReturnPath } from "@/app/api/conselho-classe/google-gsi-callback/route";
import { PUBLIC_PATHS, PUBLIC_PREFIXES, SELF_AUTH_API_PREFIXES } from "@/lib/proxyConstants";
import { computeNextHeaderHiddenState } from "@/lib/useAutoHideHeader";

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

describe("Autovínculo Docente por Código da Escola e Auth Google Mobile", () => {
  it("gera, formata, valida, expira e revoga código de convite em settingsJson com comparação segura", () => {
    const now = Date.UTC(2026, 10, 27, 12, 0, 0);
    const created = createTeacherInviteRecord({
      schoolId: "school-x",
      expiresInDays: 7,
      updatedByEmail: "pedagoga@escola.pr.gov.br",
      nowMs: now,
    });

    expect(created.plainCode).toHaveLength(8);
    expect(created.formattedCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const settings = mergeSchoolTeacherInviteSettings('{"edition":"PILOTO_INTEGRADA"}', created.state);
    const parsed = parseSchoolTeacherInviteSettings(settings);
    expect(parsed).not.toBeNull();
    expect(isSchoolTeacherInviteActive(parsed, now + 1000)).toBe(true);
    expect(isSchoolTeacherInviteActive(parsed, now + 8 * 86_400_000)).toBe(false);

    // Aceita código com ou sem hífen / minúsculo para a escola correta
    expect(
      verifySchoolTeacherInviteCode({
        providedCode: created.formattedCode.toLowerCase(),
        schoolId: "school-x",
        state: parsed,
        nowMs: now + 1000,
      })
    ).toBe(true);

    // Rejeita código válido em outra escola (isolamento por schoolId no HMAC)
    expect(
      verifySchoolTeacherInviteCode({
        providedCode: created.plainCode,
        schoolId: "school-y",
        state: parsed,
        nowMs: now + 1000,
      })
    ).toBe(false);

    // Token assinado do link direto
    const token = createSchoolTeacherInviteToken({
      schoolId: "school-x",
      nonce: created.nonce,
      expiresAt: created.state.expiresAt!,
    });
    const verified = verifySchoolTeacherInviteToken(token, now + 1000);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.schoolId).toBe("school-x");
      expect(verified.payload.nonce).toBe(created.nonce);
    }

    // Revogação limpa teacherInvite preservando outras chaves de settingsJson
    const revokedJson = mergeSchoolTeacherInviteSettings(settings, null);
    expect(parseSchoolTeacherInviteSettings(revokedJson)).toBeNull();
    expect(JSON.parse(revokedJson).edition).toBe("PILOTO_INTEGRADA");
  });

  it("detecta mobile/WebView, largura numérica do botão GIS e bloqueia open-redirect no callback", () => {
    expect(
      isMobileBrowserUserAgent(
        "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36"
      )
    ).toBe(true);
    expect(
      isMobileBrowserUserAgent(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"
      )
    ).toBe(false);
    expect(
      isInAppWebViewUserAgent(
        "Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 WhatsApp/2.24.1"
      )
    ).toBe(true);
    expect(getSafeGsiButtonWidth(null)).toBe(320);

    expect(isSafeTeacherPortalReturnPath("/conselho-classe/professor/abc.def")).toBe(true);
    expect(isSafeTeacherPortalReturnPath("/conselho-classe/pre-conselho/abc.def")).toBe(true);
    expect(isSafeTeacherPortalReturnPath("/conselho-classe/vincular?t=123")).toBe(true);
    expect(
      isSafeTeacherPortalReturnPath(decodeURIComponent(encodeURIComponent("/conselho-classe/professor/abc.def")))
    ).toBe(true);
    expect(isSafeTeacherPortalReturnPath("//evil.com/phish")).toBe(false);
    expect(isSafeTeacherPortalReturnPath("https://evil.com")).toBe(false);
    expect(isSafeTeacherPortalReturnPath("/admin")).toBe(false);

    expect(PUBLIC_PATHS).toContain("/conselho-classe/vincular");
    expect(PUBLIC_PREFIXES).toContain("/conselho-classe/vincular/");
    expect(SELF_AUTH_API_PREFIXES).toContain("/api/conselho-classe/teacher-invite/claim");
    expect(SELF_AUTH_API_PREFIXES).toContain("/api/conselho-classe/google-gsi-callback");
  });

  it("oculta o cabeçalho ao rolar para baixo e reexibe ao rolar para cima ou voltar ao topo", () => {
    expect(
      computeNextHeaderHiddenState({ currentY: 20, lastY: 0, currentlyHidden: true })
    ).toBe(false);
    expect(
      computeNextHeaderHiddenState({ currentY: 80, lastY: 60, currentlyHidden: false })
    ).toBe(true);
    expect(
      computeNextHeaderHiddenState({ currentY: 84, lastY: 80, currentlyHidden: true })
    ).toBe(true);
    expect(
      computeNextHeaderHiddenState({ currentY: 70, lastY: 84, currentlyHidden: true })
    ).toBe(false);
  });
});

describe.skipIf(!realPgUrl)(
  "Autovínculo Docente em PostgreSQL 16 Isolado",
  () => {
    const prevDevAuth = process.env.ENABLE_DEV_AUTH;

    beforeAll(async () => {
      process.env.ENABLE_DEV_AUTH = "true";
    });

    afterAll(async () => {
      if (prevDevAuth === undefined) delete process.env.ENABLE_DEV_AUTH;
      else process.env.ENABLE_DEV_AUTH = prevDevAuth;
      const { prisma } = await import("@/lib/prisma");
      await prisma.$disconnect();
    });

    beforeEach(async () => {
      const { prisma } = await import("@/lib/prisma");
      const scope = { where: { schoolId: "inv-school-a" } };
      await prisma.studentCouncilSubjectEntry.deleteMany(scope);
      await prisma.studentCouncilCard.deleteMany(scope);
      await prisma.classCouncilTrimester.deleteMany(scope);
      await prisma.classCouncilSubject.deleteMany(scope);
      await prisma.classCouncilBoard.deleteMany(scope);
      await prisma.student.deleteMany(scope);
      await prisma.classGroup.deleteMany(scope);
      await prisma.auditLog.deleteMany({
        where: { OR: [{ schoolId: "inv-school-a" }, { userId: "inv-pedagoga" }] },
      });
      await prisma.userSchool.deleteMany({ where: { userId: "inv-pedagoga" } });
      await prisma.user.deleteMany({ where: { id: "inv-pedagoga" } });
      await prisma.school.deleteMany({ where: { id: "inv-school-a" } });

      await prisma.school.create({
        data: {
          id: "inv-school-a",
          inepCode: "41990099",
          name: "Escola Sintética Convite",
          city: "Curitiba",
          state: "PR",
          nre: "Curitiba",
          network: "ESTADUAL",
          active: true,
        },
      });
      await prisma.user.create({
        data: {
          id: "inv-pedagoga",
          name: "Pedagoga Convite",
          email: "pedagoga.convite@escola.pr.gov.br",
          role: "PEDAGOGA",
          schoolId: "inv-school-a",
          active: true,
        },
      });
      await prisma.classGroup.create({
        data: {
          id: "inv-cg-1",
          schoolId: "inv-school-a",
          name: "9º Ano A",
          segment: "FUNDAMENTAL",
          shift: "MANHA",
        },
      });
      await prisma.student.create({
        data: {
          id: "inv-stu-1",
          schoolId: "inv-school-a",
          classGroupId: "inv-cg-1",
          name: "Aluno Sigiloso Teste",
          cgm: "888888",
          phone: "41900000000",
          active: true,
        },
      });
      await prisma.classCouncilBoard.create({
        data: {
          id: "inv-board-1",
          schoolId: "inv-school-a",
          classGroupId: "inv-cg-1",
          year: new Date().getFullYear(),
        },
      });
      await prisma.classCouncilSubject.createMany({
        data: [
          {
            id: "inv-subj-vago",
            schoolId: "inv-school-a",
            boardId: "inv-board-1",
            name: "Física",
            teacherName: null,
            teacherEmail: null,
            displayOrder: 0,
            active: true,
          },
          {
            id: "inv-subj-ocupado",
            schoolId: "inv-school-a",
            boardId: "inv-board-1",
            name: "Química",
            teacherName: "Prof. Titular Secreto",
            teacherEmail: "titular.secreto@escola.pr.gov.br",
            displayOrder: 1,
            active: true,
          },
        ],
      });

      hoisted.session = {
        user: {
          id: "inv-pedagoga",
          name: "Pedagoga Convite",
          email: "pedagoga.convite@escola.pr.gov.br",
          role: "PEDAGOGA",
          schoolId: "inv-school-a",
          active: true,
        },
      };
      hoisted.cookieSchoolId = "inv-school-a";
    });

    it("gera código da escola, permite autovínculo em componente vago, bloqueia sobrescrita de ocupado e libera portal docente", async () => {
      const { POST: postInvite } = await import("@/app/api/conselho-classe/teacher-invite/route");
      const { POST: postClaim } = await import(
        "@/app/api/conselho-classe/teacher-invite/claim/route"
      );
      const { POST: postTeacherPortal } = await import(
        "@/app/api/conselho-classe/teacher-portal/[token]/route"
      );
      const { createCouncilTeacherToken } = await import("@/lib/councilTeacherToken");

      const genRes = await postInvite(
        new Request("https://www.redeativa.app.br/api/conselho-classe/teacher-invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "GENERATE", expiresInDays: 7 }),
        })
      );
      expect(genRes.status).toBe(200);
      const genBody = await genRes.json();
      expect(genBody.formattedCode).toBeTruthy();

      const portalToken = createCouncilTeacherToken({
        schoolId: "inv-school-a",
        boardId: "inv-board-1",
        trimester: 1,
        subjectId: "inv-subj-vago",
      });

      // 1. Antes do vínculo, portal bloqueia com 403
      const beforeRes = await postTeacherPortal(
        new Request(`https://www.redeativa.app.br/api/conselho-classe/teacher-portal/${portalToken.token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ googleIdToken: "dev-mock-token:novo.docente@escola.pr.gov.br" }),
        }),
        { params: Promise.resolve({ token: portalToken.token }) }
      );
      expect(beforeRes.status).toBe(403);

      // 2. Código errado rejeita com 403 e não vaza alunos nem nome de outro docente
      const badCodeRes = await postClaim(
        new Request("https://www.redeativa.app.br/api/conselho-classe/teacher-invite/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "dev-mock-token:novo.docente@escola.pr.gov.br",
            portalToken: portalToken.token,
            inviteCode: "ERRADO99",
          }),
        })
      );
      expect(badCodeRes.status).toBe(403);

      // 3. Código correto lista apenas turmas/componentes sem alunos e sem nome/email do titular ocupado
      const listRes = await postClaim(
        new Request("https://www.redeativa.app.br/api/conselho-classe/teacher-invite/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "dev-mock-token:novo.docente@escola.pr.gov.br",
            portalToken: portalToken.token,
            inviteCode: genBody.formattedCode,
          }),
        })
      );
      expect(listRes.status).toBe(200);
      const listBody = await listRes.json();
      const serialized = JSON.stringify(listBody);
      expect(serialized).not.toContain("Aluno Sigiloso Teste");
      expect(serialized).not.toContain("Prof. Titular Secreto");
      expect(serialized).not.toContain("titular.secreto@escola.pr.gov.br");

      // 4. Autovínculo grava componente vago e ignora tentativa no componente ocupado
      const claimRes = await postClaim(
        new Request("https://www.redeativa.app.br/api/conselho-classe/teacher-invite/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleIdToken: "dev-mock-token:novo.docente@escola.pr.gov.br",
            portalToken: portalToken.token,
            inviteCode: genBody.formattedCode,
            subjectIds: ["inv-subj-vago", "inv-subj-ocupado"],
          }),
        })
      );
      expect(claimRes.status).toBe(200);
      const claimBody = await claimRes.json();
      expect(claimBody.claimResult.claimedIds).toEqual(["inv-subj-vago"]);
      expect(claimBody.claimResult.skippedClaimedByOtherIds).toEqual(["inv-subj-ocupado"]);

      // 5. Agora o portal abre normalmente com 200
      const afterRes = await postTeacherPortal(
        new Request(`https://www.redeativa.app.br/api/conselho-classe/teacher-portal/${portalToken.token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ googleIdToken: "dev-mock-token:novo.docente@escola.pr.gov.br" }),
        }),
        { params: Promise.resolve({ token: portalToken.token }) }
      );
      expect(afterRes.status).toBe(200);
      const afterBody = await afterRes.json();
      expect(afterBody.council.subjects.map((s: { id: string }) => s.id)).toEqual(["inv-subj-vago"]);
    });
  }
);
