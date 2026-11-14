import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import React from "react";
import { prisma } from "@/lib/prisma";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/faltas",
  redirect: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: {
      id: "fixture-school-faltas",
      name: "Pessoa Sintética",
      email: "pessoa@example.invalid",
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

describe.skipIf(!hasIsolatedDb)("FaltasPage with isolated synthetic database", () => {
  beforeAll(async () => {
    await prisma.school.create({ data: { id: "fixture-school-faltas", inepCode: "00000012", name: "Escola Sintética faltas", city: "Cidade Sintética", state: "PR", nre: "Núcleo Sintético" } });
    await prisma.classGroup.create({ data: { id: "fixture-class-faltas", name: "Turma Sintética faltas", segment: "FUNDAMENTAL", schoolId: "fixture-school-faltas" } });
    await prisma.student.create({ data: { id: "fixture-student-faltas", name: "Estudante Sintético faltas", phone: "5500000000000", schoolId: "fixture-school-faltas", classGroupId: "fixture-class-faltas" } });
  });
  afterAll(async () => {
    await prisma.student.deleteMany({ where: { schoolId: "fixture-school-faltas" } });
    await prisma.classGroup.deleteMany({ where: { schoolId: "fixture-school-faltas" } });
    await prisma.school.deleteMany({ where: { id: "fixture-school-faltas" } });
  });
  it("renders FaltasPage without error", async () => {
    expect(await prisma.student.count({ where: { schoolId: "fixture-school-faltas" } })).toBe(1);
    const pageComponent = await FaltasPage();
    const html = renderToString(pageComponent);
    expect(html).toContain("Tabela de infrequência escolar");
  }, 30000);
});
