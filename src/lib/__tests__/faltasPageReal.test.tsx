import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import React from "react";
import { prisma } from "@/lib/prisma";
import { renderToString } from "react-dom/server";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/faltas",
  redirect: redirectMock,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: {
      id: "fixture-user-faltas",
      name: "Pessoa Sintética Faltas",
      email: "pessoa.faltas@example.invalid",
      role: "PEDAGOGA",
      schoolId: "fixture-school-faltas",
    },
  }),
}));

import FaltasPage from "@/app/faltas/page";

// Only opt-in against a deliberately named local test database.
const hasIsolatedDb = (() => {
  try {
    const url = new URL(process.env.DATABASE_URL || "");
    return process.env.REDEATIVA_TEST_ISOLATED_DB === "1" &&
      ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) &&
      url.pathname === "/redeativa_phase01_synthetic";
  } catch { return false; }
})();

const cleanupFaltasFixtures = async () => {
  await prisma.student.deleteMany({ where: { schoolId: "fixture-school-faltas" } });
  await prisma.classGroup.deleteMany({ where: { schoolId: "fixture-school-faltas" } });
  await prisma.userSchool.deleteMany({
    where: {
      OR: [
        { schoolId: "fixture-school-faltas" },
        { userId: "fixture-user-faltas" },
      ],
    },
  });
  await prisma.user.deleteMany({
    where: {
      OR: [
        { id: "fixture-user-faltas" },
        { email: "pessoa.faltas@example.invalid" },
      ],
    },
  });
  await prisma.school.deleteMany({ where: { id: "fixture-school-faltas" } });
};

describe.skipIf(!hasIsolatedDb)("FaltasPage with isolated synthetic database", () => {
  beforeAll(async () => {
    await cleanupFaltasFixtures();
    await prisma.school.create({
      data: {
        id: "fixture-school-faltas",
        inepCode: "00000012",
        name: "Escola Sintética faltas",
        city: "Cidade Sintética",
        state: "PR",
        nre: "Núcleo Sintético",
        active: true,
      },
    });
    await prisma.user.create({
      data: {
        id: "fixture-user-faltas",
        name: "Pessoa Sintética Faltas",
        email: "pessoa.faltas@example.invalid",
        role: "PEDAGOGA",
        active: true,
        schoolId: "fixture-school-faltas",
      },
    });
    await prisma.userSchool.create({
      data: {
        userId: "fixture-user-faltas",
        schoolId: "fixture-school-faltas",
        role: "PEDAGOGA",
        active: true,
      },
    });
    await prisma.classGroup.create({
      data: {
        id: "fixture-class-faltas",
        name: "Turma Sintética faltas",
        segment: "FUNDAMENTAL",
        schoolId: "fixture-school-faltas",
      },
    });
    await prisma.student.create({
      data: {
        id: "fixture-student-faltas",
        name: "Estudante Sintético faltas",
        phone: "5500000000000",
        schoolId: "fixture-school-faltas",
        classGroupId: "fixture-class-faltas",
      },
    });
  });

  afterAll(async () => {
    await cleanupFaltasFixtures();
  });

  it("renders FaltasPage without error", async () => {
    redirectMock.mockClear();
    expect(await prisma.student.count({ where: { schoolId: "fixture-school-faltas" } })).toBe(1);
    const pageComponent = await FaltasPage();
    expect(redirectMock).not.toHaveBeenCalled();
    const html = renderToString(pageComponent);
    expect(html).toContain("Tabela de infrequência escolar");
  }, 30000);
});
