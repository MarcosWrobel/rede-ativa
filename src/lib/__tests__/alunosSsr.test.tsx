import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import AlunosClient from "@/app/alunos/AlunosClient";

describe("AlunosClient SSR", () => {
  it("renders AlunosClient without error", () => {
    const html = renderToString(
      <AlunosClient
        initialStudents={[]}
        classGroups={[]}
        isAdmin={true}
      />
    );
    expect(html).toContain("Prontuário 360º de Alunos");
  });
});
