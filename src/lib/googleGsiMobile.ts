export const GSI_RETURN_COOKIE = "redeativa_gsi_return";

export function isMobileBrowserUserAgent(ua: string = ""): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
}

export function isInAppWebViewUserAgent(ua: string = ""): boolean {
  return /WhatsApp|Instagram|FBAN|FBAV|Line\/|MicroMessenger|; wv\)/i.test(ua);
}

export function getSafeGsiButtonWidth(container: HTMLElement | null): number {
  const width = container?.clientWidth || 320;
  return Math.max(240, Math.min(360, Math.floor(width)));
}

export function prepareGsiRedirectReturnCookie(pathWithSearch: string): void {
  if (typeof document === "undefined") return;
  const encoded = encodeURIComponent(pathWithSearch);
  const secureFlag =
    typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${GSI_RETURN_COOKIE}=${encoded}; Path=/; Max-Age=3600; SameSite=Lax${secureFlag}`;
}

export function readGsiRedirectErrorFromUrl(): string | null {
  if (typeof window === "undefined" || !window.location?.href) return null;
  try {
    const url = new URL(window.location.href);
    const errCode = url.searchParams.get("gsi_error");
    if (!errCode) return null;

    url.searchParams.delete("gsi_error");
    window.history?.replaceState?.({}, "", url.pathname + url.search + url.hash);

    if (errCode === "domain") {
      return "Utilize sua conta institucional @escola.pr.gov.br.";
    }
    if (errCode === "csrf") {
      return "Validação de segurança expirada. Tente entrar novamente.";
    }
    return "Não foi possível concluir o login Google. Tente novamente.";
  } catch {
    return null;
  }
}

export async function consumeRedirectGsiCredential(): Promise<string | null> {
  if (typeof window === "undefined" || !window.location?.href) return null;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get("gsi_redirect") !== "1") {
      return null;
    }
    url.searchParams.delete("gsi_redirect");
    window.history?.replaceState?.({}, "", url.pathname + url.search + url.hash);

    const res = await fetch("/api/conselho-classe/google-gsi-callback", {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { credential?: string | null };
    return data.credential?.trim() || null;
  } catch {
    return null;
  }
}
