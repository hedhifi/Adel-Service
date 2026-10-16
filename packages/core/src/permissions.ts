import type { Role } from "@adel/db";
import { AppError } from "./errors";

export type Membership = {
  entityId: string;
  name: string;
  role: Role;
};

export type Actor = {
  id: string;
  role: Role;
  name: string;
  email: string;
  auth: "session" | "token";
  entityId: string;
  entityIds: string[];
  entities: Membership[];
};

export function assertRole(actor: Actor, roles: Role[], message = "You don't have access to that.") {
  if (!roles.includes(actor.role)) throw new AppError(403, message, "forbidden");
}

export function assertOffice(actor: Actor) {
  assertRole(actor, ["admin", "office"], "Office access is required for this action.");
}

export function assertAdmin(actor: Actor) {
  assertRole(actor, ["admin"], "An administrator has to do that.");
}
