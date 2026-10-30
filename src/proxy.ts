import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authConfig } from "@/lib/auth.config";
import { checkIsAdmin } from "@/lib/roles";

const { auth: proxyAuth } = NextAuth(authConfig);

const PUBLIC_PATHS = ["/login"];
const PUBLIC_PREFIXES = ["/validar/ata/", "/assinar/ata/"];
const SELF_AUTH_API_PREFIXES = [
  "/api/auth/",
  "/api/frequencia/sync",
  "/api/serp/sync",
  "/api/atas/public/",
  "/api/atas/sign-token/",
];
const ADMIN_PAGE_PREFIXES = ["/auditoria", "/equipe"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1. Libera página de login, validação pública e endpoints com autenticação própria
  if (PUBLIC_PATHS.includes(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  if (SELF_AUTH_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  // 2. Verifica sessão JWT leve sem tocar banco de dados
  const session = await proxyAuth();
  const isAuthenticated =
    Boolean(session?.user?.email) && (session?.user as any)?.active !== false;

  if (!isAuthenticated) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Não autenticado. Faça login com sua conta institucional @escola.pr.gov.br." },
        { status: 401 }
      );
    }

    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  // 3. Restringe páginas administrativas (/auditoria, /equipe) exclusivamente ao perfil ADMIN
  if (ADMIN_PAGE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    if (!checkIsAdmin(session)) {
      return NextResponse.redirect(new URL("/busca-ativa", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|logo\\.svg|extensao-leopoldina\\.zip).*)",
  ],
};
