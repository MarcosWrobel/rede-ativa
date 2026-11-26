const AUTHENTICATED_NO_STORE_PATHS = [
  "/busca-ativa/:path*",
  "/alunos/:path*",
  "/atas/:path*",
  "/faltas/:path*",
  "/historico/:path*",
  "/equipe/:path*",
  "/auditoria/:path*",
  "/conselho-classe/:path*",
  "/relatorios/:path*",
  "/gestao/:path*",
  "/secretaria/:path*",
  "/admin/:path*",
  "/visao-geral/:path*",
  "/modelos/:path*",
  "/atestados/:path*",
  "/encaminhamentos/:path*",
  "/boletim/:path*",
  "/configuracoes/:path*",
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    agentUpgrade: "security",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/api/auth/signout",
        headers: [
          { key: "Clear-Site-Data", value: '"cache"' },
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
      {
        source: "/assinar/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
      ...AUTHENTICATED_NO_STORE_PATHS.map((source) => ({
        source,
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
        ],
      })),
    ];
  },
};

export default nextConfig;
