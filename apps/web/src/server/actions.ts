"use server";

import { zonedDateTime } from "@adel/db/zoned";
import {
  AppError,
  addVisitForm,
  addVisitNote,
  addVisitPhoto,
  approveQuote,
  clockVisit,
  completeVisit,
  convertQuote,
  createCustomer,
  createInvoice,
  createJob,
  createProperty,
  createQuote,
  createRequest,
  createApiToken,
  createUser,
  createWebhookEndpoint,
  decidePublicQuote,
  declineQuote,
  disableWebhookEndpoint,
  getCompanySettings,
  issueInvoice,
  loginWithPassword,
  logoutSession,
  recordManualPayment,
  revokeApiToken,
  saveSignature,
  saveVisitForm,
  scheduleVisit,
  sendQuote,
  setUserActive,
  updateCompanySettings,
  updateReceptionistSettings,
  updateJob,
  updateRequest,
  updateVisit,
  voidInvoice,
  createSpeechTerm,
  deleteSpeechTerm,
  setDictationLanguage,
  suggestSpeechTerm,
  switchEntity,
  updateSpeechTerm,
} from "@adel/core";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireAdmin, requireOffice, requireUser } from "./session";

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

function lines(formData: FormData) {
  try {
    const parsed = JSON.parse(text(formData, "lineItems") || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function taxBps(formData: FormData) {
  const raw = text(formData, "taxPercent");
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) return undefined;
  return Math.round(value * 100);
}

export async function loginAction(formData: FormData) {
  const next = text(formData, "next");
  try {
    const result = await loginWithPassword({ email: text(formData, "email"), password: String(formData.get("password") ?? "") });
    const jar = await cookies();
    jar.set("adel_session", result.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 14,
    });
    if (result.user.role === "tech") redirect("/tech");
    if (next.startsWith("/") && !next.startsWith("//")) redirect(next);
    redirect("/");
  } catch (err) {
    if (isRedirect(err)) throw err;
    const message = err instanceof AppError ? err.message : "Something went wrong.";
    redirect(`/login?error=${encodeURIComponent(message)}`);
  }
}

export async function logoutAction() {
  const jar = await cookies();
  const token = jar.get("adel_session")?.value;
  if (token) await logoutSession(token);
  jar.delete("adel_session");
  redirect("/login");
}

export async function switchEntityAction(formData: FormData) {
  const actor = await requireUser();
  try {
    await switchEntity(actor, text(formData, "entityId"));
  } catch (err) {
    if (isRedirect(err)) throw err;
  }
  redirect(actor.role === "tech" ? "/tech" : "/");
}

export async function createCustomerAction(formData: FormData) {
  const actor = await requireOffice();
  try {
    const customer = await createCustomer(actor, {
      name: text(formData, "name"),
      email: text(formData, "email"),
      phone: text(formData, "phone"),
      notes: text(formData, "notes"),
      brandId: text(formData, "brandId"),
    });
    if (text(formData, "line1")) {
      await createProperty(actor, customer.data.id, {
        label: text(formData, "label") || "Primary",
        line1: text(formData, "line1"),
        city: text(formData, "city"),
        state: text(formData, "state") || "FL",
        postalCode: text(formData, "postalCode"),
        accessNotes: text(formData, "accessNotes"),
      });
    }
    redirect(`/customers/${customer.data.id}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/customers/new", err);
  }
}

export async function createPropertyAction(formData: FormData) {
  const actor = await requireOffice();
  const customerId = text(formData, "customerId");
  try {
    await createProperty(actor, customerId, {
      label: text(formData, "label"),
      line1: text(formData, "line1"),
      city: text(formData, "city"),
      state: text(formData, "state") || "FL",
      postalCode: text(formData, "postalCode"),
      accessNotes: text(formData, "accessNotes"),
    });
    redirect(`/customers/${customerId}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail(`/customers/${customerId}`, err);
  }
}

export async function createRequestAction(formData: FormData) {
  const actor = await requireOffice();
  try {
    const request = await createRequest(actor, {
      customerId: text(formData, "customerId"),
      propertyId: text(formData, "propertyId"),
      brandId: text(formData, "brandId"),
      title: text(formData, "title"),
      description: text(formData, "description"),
      source: text(formData, "source") || "phone",
    });
    redirect(`/requests/${request.data.id}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/requests/new", err);
  }
}

export async function updateRequestAction(formData: FormData) {
  const actor = await requireOffice();
  const id = text(formData, "id");
  try {
    await updateRequest(actor, id, { status: text(formData, "status") });
    redirect(`/requests/${id}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail(`/requests/${id}`, err);
  }
}

export async function createQuoteAction(formData: FormData) {
  const actor = await requireOffice();
  try {
    const quote = await createQuote(actor, {
      customerId: text(formData, "customerId"),
      propertyId: text(formData, "propertyId"),
      brandId: text(formData, "brandId"),
      requestId: text(formData, "requestId") || null,
      title: text(formData, "title"),
      notes: text(formData, "notes"),
      taxRateBps: taxBps(formData),
      lineItems: lines(formData),
    });
    redirect(`/quotes/${quote.data.id}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/quotes/new", err);
  }
}

export async function sendQuoteAction(formData: FormData) {
  const actor = await requireOffice();
  const id = text(formData, "id");
  try {
    await sendQuote(actor, id);
    redirect(`/quotes/${id}?notice=Estimate link is ready to share`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail(`/quotes/${id}`, err);
  }
}

export async function approveQuoteAction(formData: FormData) {
  const actor = await requireOffice();
  const id = text(formData, "id");
  try {
    await approveQuote(actor, id, { approvedByName: text(formData, "approvedByName") });
    redirect(`/quotes/${id}?notice=Estimate approved`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail(`/quotes/${id}`, err);
  }
}

export async function declineQuoteAction(formData: FormData) {
  const actor = await requireOffice();
  const id = text(formData, "id");
  try {
    await declineQuote(actor, id, { reason: text(formData, "reason") });
    redirect(`/quotes/${id}?notice=Estimate declined`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail(`/quotes/${id}`, err);
  }
}

export async function convertQuoteAction(formData: FormData) {
  const actor = await requireOffice();
  const id = text(formData, "id");
  try {
    const job = await convertQuote(actor, id);
    redirect(`/jobs/${job.data.id}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail(`/quotes/${id}`, err);
  }
}

export async function publicDecisionAction(formData: FormData) {
  const token = text(formData, "token");
  try {
    await decidePublicQuote(token, {
      decision: text(formData, "decision"),
      name: text(formData, "name"),
      reason: text(formData, "reason"),
    });
    redirect(`/q/${token}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail(`/q/${token}`, err);
  }
}

export async function createJobAction(formData: FormData) {
  const actor = await requireOffice();
  try {
    const job = await createJob(actor, {
      customerId: text(formData, "customerId"),
      propertyId: text(formData, "propertyId"),
      brandId: text(formData, "brandId"),
      title: text(formData, "title"),
      instructions: text(formData, "instructions"),
    });
    redirect(`/jobs/${job.data.id}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/jobs/new", err);
  }
}

export async function updateJobAction(formData: FormData) {
  const actor = await requireOffice();
  const id = text(formData, "id");
  try {
    await updateJob(actor, id, { instructions: text(formData, "instructions"), title: text(formData, "title") || undefined });
    redirect(`/jobs/${id}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail(`/jobs/${id}`, err);
  }
}

export async function scheduleVisitAction(formData: FormData) {
  const actor = await requireOffice();
  const jobId = text(formData, "jobId");
  try {
    const settings = await getCompanySettings();
    const day = text(formData, "day");
    const visit = await scheduleVisit(actor, {
      jobId,
      technicianId: text(formData, "technicianId") || null,
      scheduledStart: zonedDateTime(day, text(formData, "start"), settings.timeZone).toISOString(),
      scheduledEnd: zonedDateTime(day, text(formData, "end"), settings.timeZone).toISOString(),
      formTemplateId: text(formData, "formTemplateId") || undefined,
    });
    redirect(`/jobs/${jobId}?notice=Visit scheduled&visit=${visit.data.id}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail(`/jobs/${jobId}`, err);
  }
}

export async function reassignVisitAction(formData: FormData) {
  const actor = await requireOffice();
  const id = text(formData, "id");
  const day = text(formData, "day");
  try {
    await updateVisit(actor, id, { technicianId: text(formData, "technicianId") || null });
    redirect(day ? `/schedule?day=${day}` : "/schedule");
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail(day ? `/schedule?day=${day}` : "/schedule", err);
  }
}

export async function visitStatusAction(formData: FormData) {
  const actor = await requireUser();
  const id = text(formData, "id");
  try {
    const status = text(formData, "status");
    if (status === "completed") await completeVisit(actor, id);
    else await updateVisit(actor, id, { status });
    redirect(`/tech/visits/${id}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail(`/tech/visits/${id}`, err);
  }
}

export async function noteAction(formData: FormData) {
  const actor = await requireUser();
  const id = text(formData, "id");
  try {
    const sourceLanguage = text(formData, "sourceLanguage");
    await addVisitNote(actor, id, {
      body: text(formData, "body"),
      rawBody: text(formData, "rawBody") || null,
      sourceLanguage: sourceLanguage === "es" || sourceLanguage === "en" ? sourceLanguage : null,
    });
    redirect(`/tech/visits/${id}#notes`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail(`/tech/visits/${id}`, err);
  }
}

export async function photoAction(formData: FormData) {
  const actor = await requireUser();
  const id = text(formData, "id");
  try {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError(400, "Choose a photo.", "invalid_file");
    await addVisitPhoto(actor, id, {
      bytes: Buffer.from(await file.arrayBuffer()),
      contentType: file.type,
      caption: text(formData, "caption"),
      rawCaption: text(formData, "rawCaption") || null,
    });
    redirect(`/tech/visits/${id}#photos`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail(`/tech/visits/${id}`, err);
  }
}

export async function signatureAction(formData: FormData) {
  const actor = await requireUser();
  const id = text(formData, "id");
  try {
    await saveSignature(actor, id, {
      signedByName: text(formData, "signedByName"),
      signedByRaw: text(formData, "signedByRaw") || null,
      signaturePng: String(formData.get("signaturePng") ?? ""),
    });
    redirect(`/tech/visits/${id}?notice=Signature saved`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail(`/tech/visits/${id}`, err);
  }
}

export async function clockAction(formData: FormData) {
  const actor = await requireUser();
  const id = text(formData, "id");
  try {
    await clockVisit(actor, id, { action: text(formData, "action"), note: text(formData, "note") || undefined, rawNote: text(formData, "rawNote") || undefined });
    redirect(`/tech/visits/${id}#time`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail(`/tech/visits/${id}`, err);
  }
}

export async function addFormAction(formData: FormData) {
  const actor = await requireUser();
  const id = text(formData, "id");
  try {
    await addVisitForm(actor, id, { templateId: text(formData, "templateId") });
    redirect(`/tech/visits/${id}#forms`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail(`/tech/visits/${id}`, err);
  }
}

export async function saveFormAction(formData: FormData) {
  const actor = await requireUser();
  const visitId = text(formData, "visitId");
  const formId = text(formData, "formId");
  try {
    const checked = new Set(formData.getAll("item").map(String));
    const responses = formData.getAll("itemId").map((itemId) => ({
      itemId: String(itemId),
      checked: checked.has(String(itemId)),
      note: String(formData.get(`note__${itemId}`) ?? ""),
      rawNote: String(formData.get(`raw__${itemId}`) ?? ""),
    }));
    await saveVisitForm(actor, visitId, formId, { responses });
    redirect(`/tech/visits/${visitId}#forms`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail(`/tech/visits/${visitId}`, err);
  }
}

export async function createInvoiceAction(formData: FormData) {
  const actor = await requireOffice();
  const jobId = text(formData, "jobId");
  try {
    const itemLines = lines(formData);
    const invoice = await createInvoice(actor, { jobId, lineItems: itemLines.length ? itemLines : undefined });
    redirect(`/invoices/${invoice.data.id}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail(`/jobs/${jobId}`, err);
  }
}

export async function issueInvoiceAction(formData: FormData) {
  const actor = await requireOffice();
  const id = text(formData, "id");
  try {
    await issueInvoice(actor, id);
    redirect(`/invoices/${id}?notice=Invoice issued`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail(`/invoices/${id}`, err);
  }
}

export async function voidInvoiceAction(formData: FormData) {
  const actor = await requireOffice();
  const id = text(formData, "id");
  try {
    await voidInvoice(actor, id);
    redirect(`/invoices/${id}?notice=Invoice voided`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail(`/invoices/${id}`, err);
  }
}

export async function manualPaymentAction(formData: FormData) {
  const actor = await requireOffice();
  const id = text(formData, "id");
  try {
    const dollars = Number(text(formData, "amount"));
    await recordManualPayment(actor, id, {
      method: text(formData, "method"),
      amountCents: Math.round(dollars * 100),
      reference: text(formData, "reference"),
    });
    redirect(`/invoices/${id}?notice=Payment recorded`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail(`/invoices/${id}`, err);
  }
}

export async function createUserAction(formData: FormData) {
  const actor = await requireAdmin();
  try {
    await createUser(actor, {
      name: text(formData, "name"),
      email: text(formData, "email"),
      password: String(formData.get("password") ?? ""),
      role: text(formData, "role"),
      phone: text(formData, "phone"),
    });
    redirect("/settings/team?notice=Person added");
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/settings/team", err);
  }
}

export async function setUserActiveAction(formData: FormData) {
  const actor = await requireAdmin();
  try {
    await setUserActive(actor, text(formData, "id"), { active: text(formData, "active") === "true" });
    redirect("/settings/team");
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/settings/team", err);
  }
}

export async function createTokenAction(formData: FormData) {
  const actor = await requireAdmin();
  try {
    const token = await createApiToken(actor, {
      name: text(formData, "name"),
      role: text(formData, "role"),
      userId: text(formData, "userId") || undefined,
    });
    redirect(`/settings/tokens?secret=${encodeURIComponent(token.secret)}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/settings/tokens", err);
  }
}

export async function revokeTokenAction(formData: FormData) {
  const actor = await requireAdmin();
  try {
    await revokeApiToken(actor, text(formData, "id"));
    redirect("/settings/tokens?notice=Token revoked");
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/settings/tokens", err);
  }
}

export async function createWebhookAction(formData: FormData) {
  const actor = await requireOffice();
  try {
    const events = formData.getAll("events").map(String);
    const hook = await createWebhookEndpoint(actor, {
      url: text(formData, "url"),
      description: text(formData, "description"),
      events,
    });
    redirect(`/settings/webhooks?secret=${encodeURIComponent(hook.secret)}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/settings/webhooks", err);
  }
}

export async function disableWebhookAction(formData: FormData) {
  const actor = await requireOffice();
  try {
    await disableWebhookEndpoint(actor, text(formData, "id"));
    redirect("/settings/webhooks?notice=Endpoint turned off");
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/settings/webhooks", err);
  }
}

export async function updateSettingsAction(formData: FormData) {
  const actor = await requireAdmin();
  try {
    await updateCompanySettings(actor, {
      legalName: text(formData, "legalName"),
      timeZone: text(formData, "timeZone"),
      defaultTaxRateBps: taxBps(formData) ?? 0,
      taxLabel: text(formData, "taxLabel"),
      requireSignatureToComplete: formData.get("requireSignatureToComplete") === "on",
      shopAddress: text(formData, "shopAddress"),
      trackingStart: text(formData, "trackingStart") || undefined,
      trackingEnd: text(formData, "trackingEnd") || undefined,
      locationRetentionDays: Number(text(formData, "locationRetentionDays") || "14"),
      reportRemindersEnabled: formData.get("reportRemindersEnabled") === "on",
      reportReminderGraceSeconds: Number(text(formData, "reportReminderGraceMinutes") || "2") * 60,
    });
    redirect("/settings?notice=Company settings saved");
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/settings", err);
  }
}

export async function saveReceptionistSettingsAction(formData: FormData) {
  const actor = await requireOffice();
  const days = formData
    .getAll("hoursDays")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
  const onCall = text(formData, "onCallUserId");
  try {
    await updateReceptionistSettings(actor, {
      enabled: formData.get("enabled") === "on",
      greetingEn: text(formData, "greetingEn"),
      greetingEs: text(formData, "greetingEs"),
      hoursStart: text(formData, "hoursStart"),
      hoursEnd: text(formData, "hoursEnd"),
      hoursDays: days,
      onCallUserId: onCall || null,
    });
    redirect("/receptionist/settings?notice=Receptionist settings saved");
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/receptionist/settings", err);
  }
}

export async function createTermAction(formData: FormData) {
  const actor = await requireOffice();
  try {
    await createSpeechTerm(actor, { phrase: text(formData, "phrase") });
    redirect("/settings/terms?notice=Term added");
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/settings/terms", err);
  }
}

export async function updateTermAction(formData: FormData) {
  const actor = await requireOffice();
  try {
    const status = text(formData, "status");
    await updateSpeechTerm(actor, text(formData, "id"), {
      phrase: text(formData, "phrase") || undefined,
      status: status === "active" || status === "suggested" ? status : undefined,
    });
    redirect("/settings/terms?notice=Term updated");
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/settings/terms", err);
  }
}

export async function deleteTermAction(formData: FormData) {
  const actor = await requireOffice();
  try {
    await deleteSpeechTerm(actor, text(formData, "id"));
    redirect("/settings/terms?notice=Term removed");
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail("/settings/terms", err);
  }
}

export async function setDictationLanguageAction(language: "en" | "es") {
  const actor = await requireUser();
  await setDictationLanguage(actor, { language });
}

export async function suggestTermAction(formData: FormData) {
  const actor = await requireUser();
  const visitId = text(formData, "visitId");
  const back = visitId ? `/tech/visits/${visitId}` : "/settings/terms";
  try {
    await suggestSpeechTerm(actor, { phrase: text(formData, "phrase") });
    redirect(`${back}?notice=${encodeURIComponent("Spelling sent to the office")}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    bail(back, err);
  }
}
