import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import React from "react";
import { prisma } from "@/lib/prisma";
import { renderToString } from "react-dom/server";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/busca-ativa",
  redirect: redirectMock,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: {
      id: "fixture-user-busca",
      name: "Pessoa Sintética Busca",
      email: "pessoa.busca@example.invalid",
      role: "PEDAGOGA",
      schoolId: "fixture-school-busca",
    },
  }),
}));

import BuscaAtivaPage from "@/app/busca-ativa/page";

// Only opt-in against a deliberately named local test database.
const hasIsolatedDb = (() => {
  try {
    const url = new URL(process.env.DATABASE_URL || "");
    return process.env.REDEATIVA_TEST_ISOLATED_DB === "1" &&
      ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) &&
      url.pathname === "/redeativa_phase01_synthetic";
  } catch { return false; }
})();

const cleanupBuscaFixtures = async () => {
  await prisma.student.deleteMany({ where: { schoolId: "fixture-school-busca" } });
  await prisma.classGroup.deleteMany({ where: { schoolId: "fixture-school-busca" } });
  await prisma.userSchool.deleteMany({
    where: {
      OR: [
        { schoolId: "fixture-school-busca" },
        { userId: "fixture-user-busca" },
      ],
    },
  });
  await prisma.user.deleteMany({
    where: {
      OR: [
        { id: "fixture-user-busca" },
        { email: "pessoa.busca@example.invalid" },
      ],
    },
  });
  await prisma.school.deleteMany({ where: { id: "fixture-school-busca" } });
};

describe.skipIf(!hasIsolatedDb)("BuscaAtivaPage with isolated synthetic database", () => {
  beforeAll(async () => {
    await cleanupBuscaFixtures();
    await prisma.school.create({
      data: {
        id: "fixture-school-busca",
        inepCode: "00000011",
        name: "Escola Sintética busca",
        city: "Cidade Sintética",
        state: "PR",
        nre: "Núcleo Sintético",
        active: true,
      },
    });
    await prisma.user.create({
      data: {
        id: "fixture-user-busca",
        name: "Pessoa Sintética Busca",
        email: "pessoa.busca@example.invalid",
        role: "PEDAGOGA",
        active: true,
        schoolId: "fixture-school-busca",
      },
    });
    await prisma.userSchool.create({
      data: {
        userId: "fixture-user-busca",
        schoolId: "fixture-school-busca",
        role: "PEDAGOGA",
        active: true,
      },
    });
    await prisma.classGroup.create({
      data: {
        id: "fixture-class-busca",
        name: "Turma Sintética busca",
        segment: "FUNDAMENTAL",
        schoolId: "fixture-school-busca",
      },
    });
    await prisma.student.create({
      data: {
        id: "fixture-student-busca",
        name: "Estudante Sintético busca",
        phone: "5500000000000",
        schoolId: "fixture-school-busca",
        classGroupId: "fixture-class-busca",
      },
    });
  });

  afterAll(async () => {
    await cleanupBuscaFixtures();
  });

  it("renders BuscaAtivaPage without error", async () => {
    redirectMock.mockClear();
    expect(await prisma.student.count({ where: { schoolId: "fixture-school-busca" } })).toBe(1);
    const pageComponent = await BuscaAtivaPage({
      searchParams: Promise.resolve({}),
    });
    expect(redirectMock).not.toHaveBeenCalled();
    const html = renderToString(pageComponent);
    expect(html).toContain("Painel de Busca Ativa");
    expect(html).toContain("Estudante Sintético busca");
  }, 15000);
});
