import { beforeEach } from "vitest";
import { truncateAll } from "@adel/db";

beforeEach(async () => {
  await truncateAll();
});
