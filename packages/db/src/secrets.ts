import { createHash, randomBytes } from "node:crypto";

export function pepper() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET must be at least 16 characters.");
    }
    return "dev-only-session-secret";
  }
  return secret;
}

export function hashSecret(value: string) {
  return createHash("sha256").update(`${pepper()}:${value}`).digest("hex");
}

export function newSecret(prefix: string) {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}
