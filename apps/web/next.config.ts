import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
loadEnv({ path: path.join(root, ".env") });

if (process.env.UPLOAD_DIR && !path.isAbsolute(process.env.UPLOAD_DIR)) {
  process.env.UPLOAD_DIR = path.resolve(root, process.env.UPLOAD_DIR);
}

const nextConfig: NextConfig = {
  transpilePackages: ["@adel/db", "@adel/core"],
  serverExternalPackages: ["postgres", "bcryptjs", "stripe"],
};

export default nextConfig;
