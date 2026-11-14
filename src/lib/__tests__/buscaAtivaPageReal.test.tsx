import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import React from "react";
import { prisma } from "@/lib/prisma";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/busca-ativa",
  redirect: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: {
      id: "fixture-school-busca",
      name: "Pessoa Sintética",
      email: "pessoa@example.invalid",
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

describe.skipIf(!hasIsolatedDb)("BuscaAtivaPage with isolated synthetic database", () => {
  beforeAll(async () => {
    await prisma.school.create({ data: { id: "fixture-school-busca", inepCode: "00000011", name: "Escola Sintética busca", city: "Cidade Sintética", state: "PR", nre: "Núcleo Sintético" } });
    await prisma.classGroup.create({ data: { id: "fixture-class-busca", name: "Turma Sintética busca", segment: "FUNDAMENTAL", schoolId: "fixture-school-busca" } });
    await prisma.student.create({ data: { id: "fixture-student-busca", name: "Estudante Sintético busca", phone: "5500000000000", schoolId: "fixture-school-busca", classGroupId: "fixture-class-busca" } });
  });
  afterAll(async () => {
    await prisma.student.deleteMany({ where: { schoolId: "fixture-school-busca" } });
    await prisma.classGroup.deleteMany({ where: { schoolId: "fixture-school-busca" } });
    await prisma.school.deleteMany({ where: { id: "fixture-school-busca" } });
  });
  it("renders BuscaAtivaPage without error", async () => {
    expect(await prisma.student.count({ where: { schoolId: "fixture-school-busca" } })).toBe(1);
    const pageComponent = await BuscaAtivaPage({
      searchParams: Promise.resolve({}),
    });
    const html = renderToString(pageComponent);
    expect(html).toContain("Painel de Busca Ativa");
  }, 15000);
});
