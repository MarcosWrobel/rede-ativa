import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/busca-ativa",
  redirect: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: {
      id: "cmvvaoxvl0000kw07c9m80sye",
      name: "NATIELE PACHECO DOS SANTOS",
      email: "natiele.pacheco.santos@escola.pr.gov.br",
      role: "PEDAGOGA",
      schoolId: "cmvvaoxvl0000kw07c9m80sye",
    },
  }),
}));

import BuscaAtivaPage from "@/app/busca-ativa/page";

const hasRealDb = Boolean(
  process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("placeholder")
);

describe.skipIf(!hasRealDb)("BuscaAtivaPage with real database", () => {
  it("renders BuscaAtivaPage without error", async () => {
    const pageComponent = await BuscaAtivaPage({
      searchParams: Promise.resolve({}),
    });
    const html = renderToString(pageComponent);
    expect(html).toContain("Painel de Busca Ativa");
  }, 15000);
});
