export const BOOTSTRAP_ADMIN_EMAIL = "marcos.wrobel@escola.pr.gov.br";

/**
 * Verifica se o e-mail é o administrador raiz institucional da escola.
 * Usa correspondência exata (nunca substring parcial).
 */
export function isBootstrapAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const normalized = email.toLowerCase().trim();
  const envAdmin =
    typeof process !== "undefined" && process.env?.ADMIN_EMAIL
      ? process.env.ADMIN_EMAIL.toLowerCase().trim()
      : "";
  return (
    normalized === BOOTSTRAP_ADMIN_EMAIL ||
    (Boolean(envAdmin) && normalized === envAdmin)
  );
}

/**
 * Valida se uma sessão pertence a um perfil ADMIN ativo.
 */
export function checkIsAdmin(session: any): boolean {
  if (!session?.user?.email) return false;
  if ((session.user as any).active === false) return false;
  const role = (session.user as any).role;
  return role === "ADMIN" || isBootstrapAdminEmail(session.user.email);
}
