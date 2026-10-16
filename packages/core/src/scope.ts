import { notFound } from "./errors";
import type { Actor } from "./permissions";

export function canSee(actor: Actor, entityId: string) {
  return actor.entityIds.includes(entityId);
}

export function assertVisible(actor: Actor, entityId: string | null | undefined, message = "Not found.") {
  if (!entityId || !canSee(actor, entityId)) throw notFound(message);
}

export function assertActiveBook(actor: Actor, entityId: string | null | undefined, message = "Not found.") {
  if (!entityId || entityId !== actor.entityId) throw notFound(message);
}
