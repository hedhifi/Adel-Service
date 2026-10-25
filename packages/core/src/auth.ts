import { hashSecret, newSecret } from "@adel/db/secrets";
import { ADEL_ENTITY_ID, apiTokens, db, entities, entityMemberships, sessions, users } from "@adel/db";
import bcrypt from "bcryptjs";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "./errors";
import { isUniqueViolation, optionalText, parse } from "./parse";
import { assertAdmin, assertOffice, type Actor } from "./permissions";

const SESSION_MS = 14 * 24 * 60 * 60 * 1000;

function rounds() {
  return Number(process.env.BCRYPT_ROUNDS ?? 10);
}

export function publicUser(user: { id: string; name: string; email: string; role: Actor["role"]; phone?: string | null; active?: boolean }) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone ?? null,
    active: user.active ?? true,
  };
}

async function membershipRows(userId: string) {
  return db
    .select({ entityId: entityMemberships.entityId, role: entityMemberships.role, name: entities.name })
    .from(entityMemberships)
    .innerJoin(entities, eq(entities.id, entityMemberships.entityId))
    .where(eq(entityMemberships.userId, userId))
    .orderBy(entities.name);
}

function actorFromMemberships(
  user: { id: string; name: string; email: string },
  auth: Actor["auth"],
  rows: Array<{ entityId: string; role: Actor["role"]; name: string }>,
  activeEntityId: string,
  pinned: boolean,
): Actor {
  const active = rows.find((row) => row.entityId === activeEntityId);
  if (!active) throw new AppError(401, "That login is not a member of a company.", "unauthenticated");
  const visible = pinned ? [active] : rows;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: active.role,
    auth,
    entityId: active.entityId,
    entityIds: visible.map((row) => row.entityId),
    entities: visible,
  };
}

export async function loginWithPassword(input: unknown) {
  const data = parse(
    z.object({
      email: z.string().trim().email(),
      password: z.string().min(1),
    }),
    input,
  );
  const email = data.email.toLowerCase();
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user || !user.active || !(await bcrypt.compare(data.password, user.passwordHash))) {
    throw new AppError(401, "Those credentials don't match.", "invalid_credentials");
  }
  const memberships = await membershipRows(user.id);
  const active = memberships.find((row) => row.entityId === ADEL_ENTITY_ID) ?? memberships[0];
  if (!active) throw new AppError(403, "This login is not a member of a company.", "forbidden");
  const token = newSecret("sess_");
  await db.insert(sessions).values({
    userId: user.id,
    activeEntityId: active.entityId,
    tokenHash: hashSecret(token),
    expiresAt: new Date(Date.now() + SESSION_MS),
  });
  return { token, user: publicUser(user) };
}

export async function switchEntity(actor: Actor, entityId: string) {
  if (actor.auth !== "session") throw new AppError(400, "An API token stays in one company.", "invalid_input");
  if (!actor.entityIds.includes(entityId)) throw new AppError(403, "You are not a member of that company.", "forbidden");
  await db.update(sessions).set({ activeEntityId: entityId }).where(eq(sessions.userId, actor.id));
  return { data: { entityId } };
}

export async function logoutSession(token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashSecret(token)));
}

export async function authenticateSessionToken(token: string): Promise<Actor | null> {
  const [session] = await db.select().from(sessions).where(eq(sessions.tokenHash, hashSecret(token)));
  if (!session || session.expiresAt.getTime() < Date.now()) return null;
  const [user] = await db.select().from(users).where(eq(users.id, session.userId));
  if (!user || !user.active) return null;
  const rows = await membershipRows(user.id);
  if (!rows.some((row) => row.entityId === session.activeEntityId)) return null;
  return actorFromMemberships(user, "session", rows, session.activeEntityId, false);
}

export async function authenticateBearer(header: string): Promise<Actor> {
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) throw new AppError(401, "Use a Bearer token.", "unauthenticated");
  const secret = match[1];
  const [token] = await db.select().from(apiTokens).where(eq(apiTokens.tokenHash, hashSecret(secret)));
  if (!token || token.revokedAt) throw new AppError(401, "That API token is not valid.", "unauthenticated");
  const userId = token.userId ?? token.createdById;
  if (!userId) throw new AppError(401, "That API token is not valid.", "unauthenticated");
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || !user.active) throw new AppError(401, "That API token is not valid.", "unauthenticated");
  const rows = await membershipRows(user.id);
  const membership = rows.find((row) => row.entityId === token.entityId);
  if (!membership) throw new AppError(401, "That API token is not valid.", "unauthenticated");
  if (token.role === "tech" && membership.role !== "tech") {
    throw new AppError(401, "That API token is not valid.", "unauthenticated");
  }
  await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, token.id));
  return actorFromMemberships(user, "token", [{ ...membership, role: token.role }], token.entityId, true);
}

export async function listUsers(actor: Actor) {
  assertOffice(actor);
  const rows = await db.select().from(users).orderBy(users.name);
  return { data: rows.map(publicUser) };
}

export async function createUser(actor: Actor, input: unknown) {
  assertAdmin(actor);
  const data = parse(
    z.object({
      name: z.string().trim().min(1).max(120),
      email: z.string().trim().email(),
      password: z.string().min(10).max(200),
      role: z.enum(["admin", "office", "tech"]),
      phone: optionalText,
    }),
    input,
  );
  try {
    const [user] = await db
      .insert(users)
      .values({
        name: data.name,
        email: data.email.toLowerCase(),
        passwordHash: await bcrypt.hash(data.password, rounds()),
        role: data.role,
        phone: data.phone,
      })
      .returning();
    await db.insert(entityMemberships).values({ userId: user.id, entityId: actor.entityId, role: data.role });
    return { data: publicUser(user) };
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, "That email is already in use.", "email_taken");
    throw err;
  }
}

export async function setUserActive(actor: Actor, userId: string, input: unknown) {
  assertAdmin(actor);
  const data = parse(z.object({ active: z.boolean() }), input);
  if (userId === actor.id && !data.active) {
    throw new AppError(400, "You can't deactivate your own login.", "invalid_input");
  }
  const [user] = await db.update(users).set({ active: data.active }).where(eq(users.id, userId)).returning();
  if (!user) throw new AppError(404, "Person not found.", "not_found");
  if (!data.active) await db.delete(sessions).where(eq(sessions.userId, userId));
  return { data: publicUser(user) };
}

export async function listApiTokens(actor: Actor) {
  assertAdmin(actor);
  const rows = await db.select().from(apiTokens).where(eq(apiTokens.entityId, actor.entityId)).orderBy(desc(apiTokens.createdAt));
  return {
    data: rows.map((row) => ({
      id: row.id,
      name: row.name,
      tokenPrefix: row.tokenPrefix,
      role: row.role,
      userId: row.userId,
      revokedAt: row.revokedAt,
      lastUsedAt: row.lastUsedAt,
      createdAt: row.createdAt,
    })),
  };
}

export async function createApiToken(actor: Actor, input: unknown) {
  assertAdmin(actor);
  const data = parse(
    z.object({
      name: z.string().trim().min(1).max(80),
      role: z.enum(["admin", "office", "tech"]),
      userId: z.string().uuid().optional(),
    }),
    input,
  );
  let userId = data.userId ?? null;
  if (data.role === "tech") {
    if (!userId) throw new AppError(400, "A technician token has to be tied to a technician.", "invalid_input");
    const [tech] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.role, "tech"), eq(users.active, true)));
    if (!tech) throw new AppError(400, "Pick an active technician for this token.", "invalid_input");
  } else if (userId) {
    const [person] = await db.select().from(users).where(eq(users.id, userId));
    if (!person) throw new AppError(400, "Unknown person for this token.", "invalid_input");
  } else {
    userId = actor.id;
  }
  const secret = newSecret("adel_");
  const [row] = await db
    .insert(apiTokens)
    .values({
      name: data.name,
      tokenHash: hashSecret(secret),
      tokenPrefix: secret.slice(0, 12),
      role: data.role,
      entityId: actor.entityId,
      userId,
      createdById: actor.id,
    })
    .returning();
  return {
    data: {
      id: row.id,
      name: row.name,
      tokenPrefix: row.tokenPrefix,
      role: row.role,
      userId: row.userId,
      createdAt: row.createdAt,
    },
    secret,
  };
}

export async function revokeApiToken(actor: Actor, tokenId: string) {
  assertAdmin(actor);
  const [row] = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.entityId, actor.entityId), isNull(apiTokens.revokedAt)))
    .returning();
  if (!row) {
    const [existing] = await db.select().from(apiTokens).where(and(eq(apiTokens.id, tokenId), eq(apiTokens.entityId, actor.entityId)));
    if (!existing) throw new AppError(404, "API token not found.", "not_found");
    return { data: { id: existing.id, revokedAt: existing.revokedAt } };
  }
  return { data: { id: row.id, revokedAt: row.revokedAt } };
}
