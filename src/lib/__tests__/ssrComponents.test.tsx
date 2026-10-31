import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import AppLayoutClient from "@/components/AppLayoutClient";
import TopHeader from "@/components/TopHeader";
import Sidebar from "@/components/Sidebar";
import SchoolSelector from "@/components/SchoolSelector";

describe("SSR Client Components Rendering", () => {
  const mockUser = {
    name: "MARCOS ADRIANO WROBEL",
    email: "marcos.wrobel@escola.pr.gov.br",
    role: "ADMIN",
    schoolId: "cmvvaoxvl0000kw07c9m80sye",
    schools: [],
  };

  const mockSchool = {
    id: "cmvvaoxvl0000kw07c9m80sye",
    inepCode: "41042730",
    name: "Colégio Estadual Leopoldina B. Pedroso",
    city: "Ponta Grossa",
    state: "PR",
    nre: "Ponta Grossa",
    network: "ESTADUAL",
    phone: "(42) 3224-0000",
    email: "leopoldinabpedroso@escola.pr.gov.br",
    logoUrl: "/logo.svg",
  };

  it("renders SchoolSelector without errors", () => {
    const html = renderToString(
      <SchoolSelector
        currentSchool={mockSchool}
        userSchools={mockUser.schools}
        isAdmin={mockUser.role === "ADMIN"}
      />
    );
    expect(html).toContain("Colégio Estadual Leopoldina");
  });

  it("renders TopHeader without errors", () => {
    const html = renderToString(
      <TopHeader
        currentUser={mockUser}
        currentSchool={mockSchool}
        onOpenMobile={() => {}}
      />
    );
    expect(html).toContain("MARCOS ADRIANO WROBEL");
  });

  it("renders Sidebar without errors", () => {
    const html = renderToString(
      <Sidebar
        currentUser={mockUser}
        currentSchool={mockSchool}
        mobileOpen={false}
        setMobileOpen={() => {}}
      />
    );
    expect(html).toContain("Leopoldina");
  });

  it("renders AppLayoutClient with children without errors", () => {
    const html = renderToString(
      <AppLayoutClient currentUser={mockUser} currentSchool={mockSchool}>
        <div>Conteúdo da página de teste</div>
      </AppLayoutClient>
    );
    expect(html).toContain("Conteúdo da página de teste");
  });
});
