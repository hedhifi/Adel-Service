"use server";

import {
  AppError,
  connectQuickBooks,
  createCatalogItem,
  createChargeFromVisit,
  createIntercompanyCharge,
  createIntercompanyRate,
  disconnectQuickBooks,
  generateIntercompanyInvoice,
  resolveQuickBooksConflict,
  retryQuickBooks,
  settleIntercompany,
  syncQuickBooks,
  updateCatalogItem,
  updateIntercompanyRate,
  voidIntercompanyCharge,
} from "@adel/core";
import { redirect } from "next/navigation";
import { requireOffice } from "./session";

function isRedirect(err: unknown) {
  return typeof err === "object" && err !== null && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");
}

function bail(path: string, err: unknown): never {
  const message = err instanceof AppError ? err.message : "Something went wrong.";
  const join = path.includes("?") ? "&" : "?";
  redirect(`${path}${join}error=${encodeURIComponent(message)}`);
}

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function dollarsToCents(raw: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw new AppError(400, "Enter a dollar amount like 95 or 95.00.", "invalid_input");
  const [whole, fraction = ""] = raw.split(".");
  return Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
}

export async function connectQuickBooksAction() {
  const actor = await requireOffice();
  try {
    const result = await connectQuickBooks(actor);
    if ("authorizationUrl" in result.data && result.data.authorizationUrl) redirect(result.data.authorizationUrl);
    redirect("/books?notice=QuickBooks sandbox connected");
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/books", err);
  }
}

export async function disconnectQuickBooksAction() {
  const actor = await requireOffice();
  try {
    await disconnectQuickBooks(actor);
    redirect("/books?notice=QuickBooks sync is off for this company");
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/books", err);
  }
}

export async function syncQuickBooksAction() {
  const actor = await requireOffice();
  try {
    const { data } = await syncQuickBooks(actor);
    redirect(`/books?notice=${encodeURIComponent(`Pushed ${data.pushed}, pulled ${data.pulled}, conflicts ${data.conflicts}, failed ${data.failed}.`)}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/books", err);
  }
}

export async function retryQuickBooksAction() {
  const actor = await requireOffice();
  try {
    const { data } = await retryQuickBooks(actor, { force: true });
    redirect(`/books?notice=${encodeURIComponent(`Retried. Pushed ${data.pushed}, failed ${data.failed}, conflicts ${data.conflicts}.`)}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/books", err);
  }
}

export async function resolveConflictAction(formData: FormData) {
  const actor = await requireOffice();
  try {
    await resolveQuickBooksConflict(actor, {
      resourceType: text(formData, "resourceType"),
      resourceId: text(formData, "resourceId"),
      choice: text(formData, "choice"),
    });
    redirect("/books?notice=Conflict resolved");
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/books", err);
  }
}

export async function createItemAction(formData: FormData) {
  const actor = await requireOffice();
  try {
    await createCatalogItem(actor, {
      name: text(formData, "name"),
      description: text(formData, "description") || null,
      kind: text(formData, "kind") || "other",
      sku: text(formData, "sku") || null,
      unitAmountCents: dollarsToCents(text(formData, "price") || "0"),
      taxable: formData.get("taxable") === "on",
    });
    redirect("/books/items?notice=Item saved");
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/books/items", err);
  }
}

export async function updateItemAction(formData: FormData) {
  const actor = await requireOffice();
  try {
    await updateCatalogItem(actor, text(formData, "id"), { active: formData.get("active") === "true" });
    redirect("/books/items?notice=Item updated");
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/books/items", err);
  }
}

export async function createRateAction(formData: FormData) {
  const actor = await requireOffice();
  try {
    await createIntercompanyRate(actor, {
      supplyingEntityId: text(formData, "supplyingEntityId"),
      consumingEntityId: text(formData, "consumingEntityId"),
      kind: text(formData, "kind"),
      name: text(formData, "name"),
      unit: text(formData, "unit"),
      unitAmountCents: dollarsToCents(text(formData, "price") || "0"),
    });
    redirect("/intercompany?notice=Rate saved");
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/intercompany", err);
  }
}

export async function deactivateRateAction(formData: FormData) {
  const actor = await requireOffice();
  try {
    await updateIntercompanyRate(actor, text(formData, "id"), { active: false });
    redirect("/intercompany?notice=Rate turned off");
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/intercompany", err);
  }
}

export async function createChargeAction(formData: FormData) {
  const actor = await requireOffice();
  try {
    const override = text(formData, "price");
    await createIntercompanyCharge(actor, {
      supplyingEntityId: text(formData, "supplyingEntityId"),
      consumingEntityId: text(formData, "consumingEntityId"),
      rateId: text(formData, "rateId"),
      quantity: text(formData, "quantity"),
      description: text(formData, "description"),
      unitAmountCents: override ? dollarsToCents(override) : undefined,
    });
    redirect("/intercompany?notice=Charge recorded");
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/intercompany", err);
  }
}

export async function chargeVisitAction(formData: FormData) {
  const actor = await requireOffice();
  try {
    await createChargeFromVisit(actor, {
      visitId: text(formData, "visitId"),
      supplyingEntityId: text(formData, "supplyingEntityId"),
      rateId: text(formData, "rateId"),
    });
    redirect("/intercompany?notice=Visit charged to the other company");
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/intercompany", err);
  }
}

export async function voidChargeAction(formData: FormData) {
  const actor = await requireOffice();
  try {
    await voidIntercompanyCharge(actor, text(formData, "id"));
    redirect("/intercompany?notice=Charge voided");
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/intercompany", err);
  }
}

export async function generateIntercompanyAction(formData: FormData) {
  const actor = await requireOffice();
  try {
    const result = await generateIntercompanyInvoice(actor, {
      supplyingEntityId: text(formData, "supplyingEntityId"),
      consumingEntityId: text(formData, "consumingEntityId"),
    });
    redirect(`/intercompany?notice=${encodeURIComponent(`Invoice ${result.data.invoiceNumber} and bill ${result.data.billNumber} are in the two books.`)}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/intercompany", err);
  }
}

export async function settleIntercompanyAction(formData: FormData) {
  const actor = await requireOffice();
  try {
    await settleIntercompany(actor, {
      linkId: text(formData, "linkId"),
      amountCents: dollarsToCents(text(formData, "amount")),
      reference: text(formData, "reference") || undefined,
    });
    redirect("/intercompany?notice=Settlement recorded in both books");
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/intercompany", err);
  }
}
