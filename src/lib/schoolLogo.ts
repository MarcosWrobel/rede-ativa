/**
 * Utilitário leve para evitar trafegar logos Base64 de ~1 MB em queries SQL rotineiras
 * (Layout, getCurrentSchool, listagens SSR/API e tokens JWT).
 */

export function isInlineBase64Logo(logoUrl?: string | null): boolean {
  if (!logoUrl) return false;
  return logoUrl.trim().toLowerCase().startsWith("data:");
}

export function isProxyLogoPath(logoUrl?: string | null): boolean {
  if (!logoUrl) return false;
  return logoUrl.trim().startsWith("/api/schools/") && logoUrl.includes("/logo");
}

/**
 * Converte a referência do brasão para uma URL cacheável leve:
 * - Preserva caminhos estáticos ou URLs curtas (<= 512 chars, ex.: "/logo.svg", "/brasao-tibagi.png").
 * - Substitui payloads pesados ou omitidos do `select` pela rota binária cacheada `/api/schools/[id]/logo?v=...`.
 */
export function resolveSchoolLogoProxyUrl(school: {
  id?: string | null;
  logoUrl?: string | null;
  updatedAt?: Date | string | null;
}): string {
  const raw = school.logoUrl?.trim();
  if (raw && !isInlineBase64Logo(raw) && raw.length <= 512) {
    return raw;
  }

  const id = school.id?.trim();
  if (id && id !== "default-leopoldina") {
    const version = school.updatedAt
      ? new Date(school.updatedAt).getTime()
      : 1;
    return `/api/schools/${id}/logo?v=${Number.isFinite(version) ? version : 1}`;
  }

  return "/logo.svg";
}
