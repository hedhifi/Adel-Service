import { authenticateSessionToken, type Actor } from "@adel/core";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function getActor(): Promise<Actor | null> {
  const jar = await cookies();
  const token = jar.get("adel_session")?.value;
  if (!token) return null;
  return authenticateSessionToken(token);
}

export async function requireUser() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  return actor;
}

export async function requireOffice() {
  const actor = await requireUser();
  if (actor.role === "tech") redirect("/tech");
  return actor;
}

export async function requireAdmin() {
  const actor = await requireOffice();
  if (actor.role !== "admin") redirect("/settings?forbidden=1");
  return actor;
}
