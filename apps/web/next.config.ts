import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
loadEnv({ path: path.join(root, ".env") });

if (process.env.UPLOAD_DIR && !path.isAbsolute(process.env.UPLOAD_DIR)) {
  process.env.UPLOAD_DIR = path.resolve(root, process.env.UPLOAD_DIR);
}

let appHost: string | undefined;
if (process.env.APP_URL) {
  try {
    appHost = new URL(process.env.APP_URL).host;
  } catch {
    appHost = undefined;
  }
}

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self)" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ["@adel/db", "@adel/core"],
  serverExternalPackages: ["postgres", "bcryptjs", "stripe", "@aws-sdk/client-s3"],
  ...(appHost ? { experimental: { serverActions: { allowedOrigins: [appHost] } } } : {}),
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
