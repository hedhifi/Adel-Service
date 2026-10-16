import path from "node:path";
import { defineConfig } from "vitest/config";

const databaseUrl = process.env.TEST_DATABASE_URL ?? "postgres://adel:adel@localhost:5432/adel_test";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    hookTimeout: 60000,
    testTimeout: 30000,
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/truncate.ts"],
    include: ["tests/adel.test.ts"],
    env: {
      DATABASE_URL: databaseUrl,
      TEST_DATABASE_URL: databaseUrl,
      SESSION_SECRET: "test-session-secret-value",
      BCRYPT_ROUNDS: "4",
      UPLOAD_DIR: path.resolve(__dirname, "data/test-uploads"),
      NODE_ENV: "test",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "apps/web/src"),
      "@adel/db/secrets": path.resolve(__dirname, "packages/db/src/secrets.ts"),
      "@adel/db/money": path.resolve(__dirname, "packages/db/src/money.ts"),
      "@adel/db/zoned": path.resolve(__dirname, "packages/db/src/zoned.ts"),
      "@adel/db": path.resolve(__dirname, "packages/db/src/index.ts"),
      "@adel/core": path.resolve(__dirname, "packages/core/src/index.ts"),
    },
  },
});
