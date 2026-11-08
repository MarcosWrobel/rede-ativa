/**
 * Definições canônicas de prefixos e rotas públicas / de autenticação própria
 * Compartilhadas entre src/proxy.ts e os testes automatizados
 */

export const PUBLIC_PATHS = ["/", "/login", "/impacto"];

export const PUBLIC_PREFIXES = ["/validar/ata/", "/assinar/ata/"];

export const SELF_AUTH_API_PREFIXES = [
  "/api/auth/",
  "/api/frequencia/sync",
  "/api/serp/sync",
  "/api/atas/public/",
  "/api/atas/sign-token/",
  "/api/cron/weekly-digest",
  "/api/webhooks/whatsapp",
];

export const ADMIN_PAGE_PREFIXES = ["/auditoria", "/equipe", "/admin", "/configuracoes"];

export const CANONICAL_PRODUCTION_HOST = "www.redeativa.app.br";
export const APEX_PRODUCTION_HOST = "redeativa.app.br";

export function shouldRedirectApexToCanonical(host: string | null | undefined): boolean {
  if (!host) return false;
  const clean = host.toLowerCase().split(":")[0].trim();
  return clean === APEX_PRODUCTION_HOST;
}
