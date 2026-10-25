import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const envFile = path.join(root, ".env");

if (existsSync(envFile)) {
  const { config } = await import("dotenv");
  config({ path: envFile });
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.");
  process.exit(1);
}

const connection = postgres(url, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(connection), {
    migrationsFolder: process.env.MIGRATIONS_FOLDER ?? path.join(here, "migrations"),
  });
  console.log("Migrations applied.");
} finally {
  await connection.end();
}
