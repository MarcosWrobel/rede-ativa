import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyEscolaGoogleIdToken } from "@/lib/escolaGoogleVerify";
import { GSI_RETURN_COOKIE } from "@/lib/googleGsiMobile";
import { safeCompareStrings } from "@/lib/syncToken";

export const dynamic = "force-dynamic";

export const GSI_CREDENTIAL_COOKIE = "redeativa_gsi_cred";

export function isSafeTeacherPortalReturnPath(rawPath: string | null | undefined): boolean {
  if (!rawPath) return false;
  const trimmed = rawPath.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return false;
  return (
    trimmed.startsWith("/conselho-classe/professor/") ||
    trimmed.startsWith("/conselho-classe/pre-conselho/") ||
    trimmed === "/conselho-classe/vincular" ||
    trimmed.startsWith("/conselho-classe/vincular?") ||
    trimmed.startsWith("/conselho-classe/vincular/")
  );
}

export async function GET() {
  const cookieStore = await cookies();
  const credential = cookieStore.get(GSI_CREDENTIAL_COOKIE)?.value?.trim() || null;
  const res = NextResponse.json({ credential });
  if (credential) {
    res.cookies.set(GSI_CREDENTIAL_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
  }
  return res;
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const credential = String(formData.get("credential") || "").trim();
    const bodyCsrf = String(formData.get("g_csrf_token") || "").trim();

    const cookieStore = await cookies();
    const cookieCsrf = cookieStore.get("g_csrf_token")?.value?.trim() || "";
    const rawReturnTo = cookieStore.get(GSI_RETURN_COOKIE)?.value?.trim() || "";
    const safeReturnTo = isSafeTeacherPortalReturnPath(rawReturnTo)
      ? rawReturnTo
      : "/conselho-classe/vincular";

    if (!cookieCsrf || !bodyCsrf || !safeCompareStrings(cookieCsrf, bodyCsrf)) {
      const errUrl = new URL(safeReturnTo, req.url);
      errUrl.searchParams.set("gsi_error", "csrf");
      return NextResponse.redirect(errUrl, 303);
    }

    if (!credential) {
      const errUrl = new URL(safeReturnTo, req.url);
      errUrl.searchParams.set("gsi_error", "missing_credential");
      return NextResponse.redirect(errUrl, 303);
    }

    const googleCheck = await verifyEscolaGoogleIdToken(credential);
    if (!googleCheck.ok) {
      const errUrl = new URL(safeReturnTo, req.url);
      errUrl.searchParams.set("gsi_error", "domain");
      return NextResponse.redirect(errUrl, 303);
    }

    const targetUrl = new URL(safeReturnTo, req.url);
    targetUrl.searchParams.set("gsi_redirect", "1");
    const res = NextResponse.redirect(targetUrl, 303);
    res.cookies.set(GSI_CREDENTIAL_COOKIE, credential, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 120,
    });
    res.cookies.set(GSI_RETURN_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return res;
  } catch (err) {
    console.error("[POST /api/conselho-classe/google-gsi-callback] Erro:", err);
    return NextResponse.redirect(new URL("/conselho-classe/vincular?gsi_error=server", req.url), 303);
  }
}
