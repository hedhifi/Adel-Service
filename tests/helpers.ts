import bcrypt from "bcryptjs";
import { ADEL_ENTITY_ID, SERVICE_BRAND_ID, SERVICE_ENTITY_ID, brands, companySettings, db, entities, entityMemberships, users } from "@adel/db";
import type { Actor, Membership } from "@adel/core";

export const PASSWORD = "Fieldnote-demo-2026";

export function asActor(
  user: { id: string; name: string; email: string; role: Actor["role"] },
  entityId = ADEL_ENTITY_ID,
  entitiesForUser?: Membership[],
): Actor {
  const memberships =
    entitiesForUser ??
    [
      { entityId: ADEL_ENTITY_ID, name: "Adel Electric", role: user.role },
      { entityId: SERVICE_ENTITY_ID, name: "Service Contracts", role: user.role },
    ];
  const active = memberships.find((row) => row.entityId === entityId) ?? memberships[0];
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: active?.role ?? user.role,
    auth: "session",
    entityId: active?.entityId ?? entityId,
    entityIds: memberships.map((row) => row.entityId),
    entities: memberships,
  };
}

export async function seedCompany() {
  await db.insert(companySettings).values({
    id: "default",
    legalName: "Adel Electric, LLC",
    timeZone: "America/New_York",
    defaultTaxRateBps: 700,
    taxLabel: "Estimated Florida sales tax",
    requireSignatureToComplete: true,
    shopAddress: "4180 Enterprise Avenue, Naples, FL 34104",
  });
  await db.insert(entities).values([
    { id: ADEL_ENTITY_ID, name: "Adel Electric", slug: "adel-electric", taxRateBps: 700, taxLabel: "Estimated Florida sales tax" },
    { id: SERVICE_ENTITY_ID, name: "Service Contracts", slug: "service-contracts", taxRateBps: 700, taxLabel: "Estimated Florida sales tax" },
  ]);
  const [adel] = await db.insert(brands).values({ entityId: ADEL_ENTITY_ID, name: "Adel Electric", slug: "adel-electric" }).returning();
  await db.insert(brands).values({ id: SERVICE_BRAND_ID, entityId: SERVICE_ENTITY_ID, name: "Service Contracts", slug: "service-contracts" });
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const [admin] = await db
    .insert(users)
    .values({ name: "Alan Drespel", email: "alan@adel.example", passwordHash, role: "admin" })
    .returning();
  const [office] = await db
    .insert(users)
    .values({ name: "Renee Okonkwo", email: "renee.okonkwo@adel.example", passwordHash, role: "office" })
    .returning();
  const [tech] = await db
    .insert(users)
    .values({ name: "Marco Vell", email: "marco.vell@adel.example", passwordHash, role: "tech" })
    .returning();
  const [otherTech] = await db
    .insert(users)
    .values({ name: "Sofia Brennan", email: "sofia.brennan@adel.example", passwordHash, role: "tech" })
    .returning();
  await db.insert(entityMemberships).values(
    [admin, office, tech, otherTech].flatMap((person) => [
      { userId: person.id, entityId: ADEL_ENTITY_ID, role: person.role },
      { userId: person.id, entityId: SERVICE_ENTITY_ID, role: person.role },
    ]),
  );
  return {
    adel,
    admin: asActor(admin),
    office: asActor(office),
    tech: asActor(tech),
    otherTech: asActor(otherTech),
  };
}
