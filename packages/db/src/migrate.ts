import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
config({ path: path.join(root, ".env") });

const { drizzle } = await import("drizzle-orm/postgres-js");
const { migrate } = await import("drizzle-orm/postgres-js/migrator");
const postgres = (await import("postgres")).default;

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
}

const connection = postgres(url, { max: 1 });
const database = drizzle(connection);
await migrate(database, { migrationsFolder: path.join(root, "packages/db/migrations") });
await connection.end();
console.log("Migrations applied.");
