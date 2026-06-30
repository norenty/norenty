const { withSentryConfig } = require("@sentry/nextjs");

/** @type {import('next').NextConfig} */
const nextConfig = {};

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
