import { handlers } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    return await handlers.GET(req);
  } catch (error: any) {
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
