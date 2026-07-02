const { withSentryConfig } = require("@sentry/nextjs");

// CSP en modo REPORT-ONLY (ítem 6.6): NO bloquea nada todavía, solo registra
// violaciones en la consola del navegador. Allowlist de lo que la app usa de
// verdad hoy: Supabase (REST + Realtime por wss), tiles de OpenStreetMap
// (Leaflet, ver MapView.jsx), Sentry (opcional, solo si hay DSN — se incluye
// igualmente porque en Report-Only no bloquea nada si no se usa). `unsafe-inline`
// SOLO en style-src (Tailwind + estilos inline de React en varios componentes);
// script-src se deja estricto a propósito para que las violaciones reales de
// script se vean en consola. Promocionar a "Content-Security-Policy" (enforcing)
// tras una semana sin violaciones inesperadas.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.supabase.co",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
        ],
      },
    ];
  },
};

// Solo aplica Sentry si hay DSN configurado; en dev sin DSN el build es idéntico al original.
const hasSentry = !!(process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN);

module.exports = hasSentry
  ? withSentryConfig(nextConfig, {
      silent: true,
      disableLogger: true,
      widenClientFileUpload: false,
      hideSourceMaps: true,
      automaticVercelMonitors: false,
    })
  : nextConfig;
