import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function GET() {
  const candidates = [
    path.resolve(process.cwd(), "openapi/openapi.json"),
    path.resolve(process.cwd(), "../../openapi/openapi.json"),
  ];
  const file = candidates.find((candidate) => existsSync(candidate));
  if (!file) return Response.json({ error: "not_found", message: "API spec is missing." }, { status: 404 });
  return new Response(readFileSync(file, "utf8"), {
    headers: { "content-type": "application/json" },
  });
}

