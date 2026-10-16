import bcrypt from "bcryptjs";
import { brands, companySettings, db, users } from "@adel/db";
import type { Actor } from "@adel/core";

export const PASSWORD = "Fieldnote-demo-2026";

export function asActor(user: { id: string; name: string; email: string; role: Actor["role"] }): Actor {
  return { id: user.id, name: user.name, email: user.email, role: user.role, auth: "session" };
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
  const [adel] = await db.insert(brands).values({ name: "Adel Electric", slug: "adel-electric" }).returning();
  const [hed] = await db.insert(brands).values({ name: "HED", slug: "hed" }).returning();
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
  return {
    adel,
    hed,
    admin: asActor(admin),
    office: asActor(office),
    tech: asActor(tech),
    otherTech: asActor(otherTech),
  };
}
