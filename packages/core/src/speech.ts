import { customers, db, speechTerms, users } from "@adel/db";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "./errors";
import { isUniqueViolation, parse } from "./parse";
import { assertOffice, type Actor } from "./permissions";
import { cleanupInstructions, fuzzyCorrect, type DictationLanguage } from "./speech-client";

export {
  NOT_TRANSLATED,
  buildSpeechGrammar,
  cleanupInstructions,
  fuzzyCorrect,
  levenshtein,
  recognitionErrorKind,
  recognitionLanguage,
  resolveDictationLanguage,
  voiceAvailability,
  voiceStatusMessage,
} from "./speech-client";
export type { DictationLanguage } from "./speech-client";

const phraseSchema = z.string().trim().min(1).max(80);

export function cleanupConfigured() {
  if ((process.env.SPEECH_CLEANUP ?? "on") === "off") return false;
  const key = process.env.SPEECH_CLEANUP_API_KEY ?? "";
  return Boolean(key) && !key.includes("replace");
}

async function completeWithProvider(instructions: string, transcript: string) {
  const provider = (process.env.SPEECH_CLEANUP_PROVIDER ?? "openai").toLowerCase();
  const key = process.env.SPEECH_CLEANUP_API_KEY ?? "";
  const model = process.env.SPEECH_CLEANUP_MODEL ?? (provider === "anthropic" ? "claude-3-5-haiku-latest" : "gpt-4o-mini");
  if (provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 800,
        system: instructions,
        messages: [{ role: "user", content: transcript }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Cleanup provider returned ${response.status}`);
    const payload = (await response.json()) as { content?: Array<{ text?: string }> };
    return payload.content?.map((part) => part.text ?? "").join("").trim() ?? "";
  }
  const base = (process.env.SPEECH_CLEANUP_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: transcript },
      ],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Cleanup provider returned ${response.status}`);
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return payload.choices?.[0]?.message?.content?.trim() ?? "";
}

export async function activeSpeechPhrases() {
  const terms = await db.select({ phrase: speechTerms.phrase }).from(speechTerms).where(eq(speechTerms.status, "active")).orderBy(asc(speechTerms.phrase));
  const names = await db.select({ name: customers.name }).from(customers).orderBy(asc(customers.name));
  return [...new Set([...terms.map((row) => row.phrase), ...names.map((row) => row.name)])];
}

function asLanguage(value: unknown): DictationLanguage {
  return value === "es" ? "es" : "en";
}

function untranslated(raw: string) {
  return { text: raw, raw, mode: "passthrough" as const, language: "es" as const, translated: false as const };
}

export async function finishDictation(transcript: string, phrases: string[], language: DictationLanguage = "en") {
  const raw = transcript.trim();
  if (!raw) throw new AppError(400, "Nothing was heard.", "invalid_input");
  if (language === "es" && !cleanupConfigured()) return untranslated(raw);
  const source = language === "es" ? raw : fuzzyCorrect(raw, phrases);
  if (!cleanupConfigured()) return { text: source, raw, mode: "passthrough" as const, language, translated: true as const };
  try {
    const cleaned = await completeWithProvider(cleanupInstructions(phrases, language), source);
    const english = fuzzyCorrect(cleaned || source, phrases);
    if (language === "es" && !cleaned) return untranslated(raw);
    return { text: english, raw, mode: "model" as const, language, translated: true as const };
  } catch (err) {
    console.error("speech cleanup failed", err);
    if (language === "es") return untranslated(raw);
    return { text: source, raw, mode: "passthrough" as const, language, translated: true as const };
  }
}

export async function prepareDictation(transcript: string, language: unknown = "en") {
  return finishDictation(transcript, await activeSpeechPhrases(), asLanguage(language));
}

export async function getDictationLanguage(userId: string): Promise<DictationLanguage> {
  const [row] = await db.select({ dictationLanguage: users.dictationLanguage }).from(users).where(eq(users.id, userId));
  return row?.dictationLanguage === "es" ? "es" : "en";
}

export async function setDictationLanguage(actor: Actor, input: unknown) {
  const data = parse(z.object({ language: z.enum(["en", "es"]) }), input);
  const [row] = await db.update(users).set({ dictationLanguage: data.language }).where(eq(users.id, actor.id)).returning();
  if (!row) throw new AppError(404, "Person not found.", "not_found");
  return { data: { language: row.dictationLanguage } };
}

function publicTerm(row: typeof speechTerms.$inferSelect) {
  return {
    id: row.id,
    phrase: row.phrase,
    status: row.status,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listSpeechTerms(actor: Actor, query: { status?: string } = {}) {
  if (query.status === "suggested") assertOffice(actor);
  else if (actor.role === "tech" && query.status && query.status !== "active") {
    throw new AppError(403, "Office access is required for this action.", "forbidden");
  }
  const status = query.status === "suggested" || query.status === "active" ? query.status : actor.role === "tech" ? "active" : undefined;
  const rows = await db.select().from(speechTerms).orderBy(asc(speechTerms.phrase));
  const data = rows.filter((row) => (status ? row.status === status : true)).map(publicTerm);
  return { data };
}

export async function createSpeechTerm(actor: Actor, input: unknown) {
  assertOffice(actor);
  const data = parse(z.object({ phrase: phraseSchema }), input);
  try {
    const [row] = await db
      .insert(speechTerms)
      .values({ phrase: data.phrase, status: "active", createdById: actor.id })
      .returning();
    return { data: publicTerm(row) };
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, "That term is already in the dictionary.", "term_exists");
    throw err;
  }
}

export async function updateSpeechTerm(actor: Actor, id: string, input: unknown) {
  assertOffice(actor);
  const data = parse(z.object({ phrase: phraseSchema.optional(), status: z.enum(["active", "suggested"]).optional() }), input);
  const [existing] = await db.select().from(speechTerms).where(eq(speechTerms.id, id));
  if (!existing) throw new AppError(404, "Term not found.", "not_found");
  try {
    const [row] = await db
      .update(speechTerms)
      .set({
        phrase: data.phrase ?? existing.phrase,
        status: data.status ?? existing.status,
        updatedAt: new Date(),
      })
      .where(eq(speechTerms.id, id))
      .returning();
    return { data: publicTerm(row) };
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, "That term is already in the dictionary.", "term_exists");
    throw err;
  }
}

export async function deleteSpeechTerm(actor: Actor, id: string) {
  assertOffice(actor);
  const [row] = await db.delete(speechTerms).where(eq(speechTerms.id, id)).returning();
  if (!row) throw new AppError(404, "Term not found.", "not_found");
  return { data: { id: row.id } };
}

export async function suggestSpeechTerm(actor: Actor, input: unknown) {
  const data = parse(z.object({ phrase: phraseSchema }), input);
  const [match] = await db
    .select()
    .from(speechTerms)
    .where(sql`lower(${speechTerms.phrase}) = lower(${data.phrase})`);
  if (match) throw new AppError(409, "That term is already in the dictionary.", "term_exists");
  try {
    const [row] = await db
      .insert(speechTerms)
      .values({ phrase: data.phrase, status: "suggested", createdById: actor.id })
      .returning();
    return { data: publicTerm(row) };
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, "That term is already in the dictionary.", "term_exists");
    throw err;
  }
}
