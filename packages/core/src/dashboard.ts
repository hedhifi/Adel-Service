import { companyToday } from "@adel/db/zoned";
import { customers, db, invoices, quotes, requests } from "@adel/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { assertOffice, type Actor } from "./permissions";
import { getCompanySettings } from "./settings";
import { listVisits } from "./work";

export async function getDashboard(actor: Actor) {
  assertOffice(actor);
  const settings = await getCompanySettings();
  const day = companyToday(settings.timeZone);
  const openRequests = await db
    .select({
      id: requests.id,
      title: requests.title,
      status: requests.status,
      customerName: customers.name,
      createdAt: requests.createdAt,
    })
    .from(requests)
    .innerJoin(customers, eq(customers.id, requests.customerId))
    .where(and(eq(requests.entityId, actor.entityId), inArray(requests.status, ["new", "reviewing"])))
    .orderBy(desc(requests.createdAt))
    .limit(6);
  const sentQuotes = await db
    .select({
      id: quotes.id,
      number: quotes.number,
      title: quotes.title,
      customerName: customers.name,
      sentAt: quotes.sentAt,
    })
    .from(quotes)
    .innerJoin(customers, eq(customers.id, quotes.customerId))
    .where(and(eq(quotes.entityId, actor.entityId), eq(quotes.status, "sent")))
    .orderBy(desc(quotes.sentAt))
    .limit(6);
  const openInvoices = await db
    .select({
      id: invoices.id,
      number: invoices.number,
      status: invoices.status,
      customerName: customers.name,
    })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .where(and(eq(invoices.entityId, actor.entityId), inArray(invoices.status, ["issued", "partial"])))
    .orderBy(desc(invoices.issuedAt))
    .limit(6);
  const today = await listVisits(actor, { day, limit: 50 });
  const [requestCount] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(requests)
    .where(and(eq(requests.entityId, actor.entityId), eq(requests.status, "new")));
  const [quoteCount] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(quotes)
    .where(and(eq(quotes.entityId, actor.entityId), eq(quotes.status, "sent")));
  const [invoiceCount] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(invoices)
    .where(and(eq(invoices.entityId, actor.entityId), inArray(invoices.status, ["issued", "partial"])));
  return {
    data: {
      day,
      timeZone: settings.timeZone,
      company: settings.legalName,
      openRequests,
      sentQuotes,
      openInvoices,
      today: today.data,
      counts: {
        newRequests: requestCount?.total ?? 0,
        quotesOut: quoteCount?.total ?? 0,
        invoicesOpen: invoiceCount?.total ?? 0,
        visitsToday: today.data.length,
      },
    },
  };
}
