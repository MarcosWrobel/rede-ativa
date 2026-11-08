import { handlers } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { CANONICAL_PRODUCTION_HOST, APEX_PRODUCTION_HOST } from "@/lib/proxyConstants";

function resolveCanonicalLoginUrl(req: NextRequest, errorCode = "Configuration"): URL {
  const authUrl = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  let base: string;
  if (authUrl && !authUrl.includes(".vercel.app")) {
    base = authUrl;
  } else {
    const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const host = forwardedHost || req.headers.get("host") || req.nextUrl.host;
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
    base = `${proto}://${host}`;
  }

  const loginUrl = new URL(`/login?error=${encodeURIComponent(errorCode)}`, base);
  if (loginUrl.hostname === APEX_PRODUCTION_HOST) {
    loginUrl.hostname = CANONICAL_PRODUCTION_HOST;
    loginUrl.protocol = "https:";
  }
  return loginUrl;
}

export async function GET(req: NextRequest) {
  try {
    return await handlers.GET(req);
  } catch (error: any) {
    if (isRedirectError(error)) {
      throw error;
    }
    const errorDetails = {
      name: error?.name,
      message: error?.message,
      type: error?.type,
      cause: error?.cause ? String(error?.cause) : undefined,
      url: req.url,
      cookiesPresent: req.cookies.getAll().map((c) => c.name),
      host: req.headers.get("host"),
      forwardedHost: req.headers.get("x-forwarded-host"),
    };
    console.error("[CRITICAL_AUTH_CALLBACK_ERROR]", errorDetails, error?.stack);

    const acceptsHtml = req.headers.get("accept")?.includes("text/html");
    if (acceptsHtml) {
      const loginUrl = resolveCanonicalLoginUrl(req, "Configuration");
      return NextResponse.redirect(loginUrl);
    }

    return NextResponse.json(
      {
        erro_autenticacao: true,
        tipo: error?.name || error?.type || "AuthError",
        mensagem: error?.message || "Falha no callback de autenticação",
        detalhes: errorDetails,
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    return await handlers.POST(req);
  } catch (error: any) {
    if (isRedirectError(error)) {
      throw error;
    }
    console.error("[CRITICAL_AUTH_POST_ERROR]", error);
    return NextResponse.json(
      {
        erro_autenticacao: true,
        mensagem: error?.message || "Falha na autenticação POST",
      },
      { status: 500 }
    );
  }
}
