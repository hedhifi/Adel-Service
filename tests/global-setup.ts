import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export default async function setup() {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? "postgres://adel:adel@localhost:5432/adel_test";
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  execFileSync("pnpm", ["--filter", "@adel/db", "exec", "tsx", "src/migrate.ts"], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      SESSION_SECRET: process.env.SESSION_SECRET ?? "test-session-secret-value",
    },
  });
}
