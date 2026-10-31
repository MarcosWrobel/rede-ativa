import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/faltas",
}));

import FaltasClient from "@/app/faltas/FaltasClient";

describe("FaltasClient SSR", () => {
  it("renders FaltasClient without error", () => {
    const html = renderToString(
      <FaltasClient
        rankedAbsences={[]}
        lowAttendance={[]}
        classGroups={[]}
        templates={[]}
        currentUser={{ name: "Test User", email: "test@escola.pr.gov.br", isAdmin: true }}
      />
    );
    expect(html).toContain("Tabela de infrequência escolar");
  });
});
