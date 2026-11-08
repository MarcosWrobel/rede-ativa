import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authConfig } from "@/lib/auth.config";
import { checkIsAdmin } from "@/lib/roles";
import {
  PUBLIC_PATHS,
  PUBLIC_PREFIXES,
  SELF_AUTH_API_PREFIXES,
  ADMIN_PAGE_PREFIXES,
  shouldRedirectApexToCanonical,
  CANONICAL_PRODUCTION_HOST,
} from "@/lib/proxyConstants";

const { auth: proxyAuth } = NextAuth(authConfig);

export async function proxy(req: NextRequest) {
  // 0. Redirecionamento canônico de apex (redeativa.app.br) para www.redeativa.app.br
  // Garante integridade de cookies de sessão/OAuth e paridade com redirecionamentos da Vercel
  const host =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host");

  if (shouldRedirectApexToCanonical(host)) {
    const url = req.nextUrl.clone();
    url.host = CANONICAL_PRODUCTION_HOST;
    url.protocol = "https:";
    return NextResponse.redirect(url, { status: 308 });
  }

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

export default proxy;

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\..*|logo.*\\.svg|extensao-rede-ativa\\.zip|extensao-leopoldina\\.zip|manifest\\.json|icon-.*\\.png).*)",
  ],
};
