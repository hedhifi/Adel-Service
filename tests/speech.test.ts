import { ADEL_ENTITY_ID, customers, db, jobs, properties, speechTerms, visits } from "@adel/db";
import {
  AppError,
  NOT_TRANSLATED,
  activeSpeechPhrases,
  addVisitNote,
  buildSpeechGrammar,
  cleanupInstructions,
  createCustomer,
  createSpeechTerm,
  deleteSpeechTerm,
  finishDictation,
  fuzzyCorrect,
  getDictationLanguage,
  getVisit,
  recognitionErrorKind,
  recognitionLanguage,
  resolveDictationLanguage,
  setDictationLanguage,
  suggestSpeechTerm,
  updateSpeechTerm,
  voiceAvailability,
  voiceStatusMessage,
} from "@adel/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { seedCompany } from "./helpers";

const phrases = ["Crestron", "Lutron", "Casambi", "Sonos", "UniFi", "2N", "Camille Calder"];

describe("voice dictation", () => {
  const previousKey = process.env.SPEECH_CLEANUP_API_KEY;
  const previousMode = process.env.SPEECH_CLEANUP;

  afterEach(() => {
    if (previousKey === undefined) delete process.env.SPEECH_CLEANUP_API_KEY;
    else process.env.SPEECH_CLEANUP_API_KEY = previousKey;
    if (previousMode === undefined) delete process.env.SPEECH_CLEANUP;
    else process.env.SPEECH_CLEANUP = previousMode;
    vi.restoreAllMocks();
  });

  it("keeps typing available when the browser has no speech engine", () => {
    expect(voiceAvailability({})).toBe("unsupported");
    expect(voiceStatusMessage("unsupported")).toBe("Voice isn't available in this browser. You can still type.");
    expect(voiceAvailability({ SpeechRecognition: function SpeechRecognition() {} })).toBe("available");
    expect(voiceAvailability({ webkitSpeechRecognition: function webkitSpeechRecognition() {} })).toBe("available");
  });

  it("keeps typing available when the microphone is blocked", () => {
    expect(recognitionErrorKind("not-allowed")).toBe("denied");
    expect(recognitionErrorKind("service-not-allowed")).toBe("denied");
    expect(recognitionErrorKind("no-speech")).toBe("failed");
    expect(voiceStatusMessage("denied")).toBe("The microphone was blocked. You can still type.");
    expect(voiceStatusMessage("failed")).toBe("Voice didn't catch that. You can still type.");
  });

  it("tells the cleanup model not to invent facts or change numbers", () => {
    const instructions = cleanupInstructions(["Crestron", "Cat6"]);
    expect(instructions).toContain("Do not invent facts.");
    expect(instructions).toContain("Do not change numbers, part numbers, or measurements.");
    expect(instructions).toContain("Crestron");
    expect(instructions).toContain("Cat6");
  });

  it("passes the transcript through, with dictionary spellings, when no API key is set", async () => {
    delete process.env.SPEECH_CLEANUP_API_KEY;
    process.env.SPEECH_CLEANUP = "on";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network"));
    const result = await finishDictation("um the krestron keypad pulled 12 awg for 40 feet", phrases);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.mode).toBe("passthrough");
    expect(result.raw).toBe("um the krestron keypad pulled 12 awg for 40 feet");
    expect(result.text).toContain("Crestron");
    expect(result.text).toContain("12");
    expect(result.text).toContain("40");
  });

  it("corrects heard phrases to the canonical spelling and leaves measurements alone", () => {
    expect(fuzzyCorrect("krestron keypad", phrases)).toBe("Crestron keypad");
    expect(fuzzyCorrect("lutrn dimmer", phrases)).toBe("Lutron dimmer");
    expect(fuzzyCorrect("casambe scene", phrases)).toBe("Casambi scene");
    expect(fuzzyCorrect("sonos amp", phrases)).toBe("Sonos amp");
    expect(fuzzyCorrect("unifi switch", phrases)).toBe("UniFi switch");
    expect(fuzzyCorrect("the 2n intercom", phrases)).toBe("the 2N intercom");
    expect(fuzzyCorrect("pulled 12 awg for 40 feet", phrases)).toBe("pulled 12 awg for 40 feet");
    expect(fuzzyCorrect("met camile calder", phrases)).toBe("met Camille Calder");
    expect(buildSpeechGrammar(phrases)).toContain("Crestron");
  });

  it("lets office edit the dictionary and lets a technician only suggest", async () => {
    const { office, tech, adel } = await seedCompany();
    await expect(createSpeechTerm(tech, { phrase: "QSC" })).rejects.toMatchObject({ status: 403 });
    await expect(updateSpeechTerm(tech, "00000000-0000-4000-8000-000000000001", { phrase: "QSC" })).rejects.toMatchObject({ status: 403 });
    await expect(deleteSpeechTerm(tech, "00000000-0000-4000-8000-000000000001")).rejects.toMatchObject({ status: 403 });

    const suggestion = await suggestSpeechTerm(tech, { phrase: "QSC" });
    expect(suggestion.data.status).toBe("suggested");
    expect(await activeSpeechPhrases()).not.toContain("QSC");

    const created = await createSpeechTerm(office, { phrase: "Savant" });
    expect(created.data.status).toBe("active");
    await expect(createSpeechTerm(office, { phrase: "savant" })).rejects.toBeInstanceOf(AppError);

    const accepted = await updateSpeechTerm(office, suggestion.data.id, { status: "active" });
    expect(accepted.data.status).toBe("active");
    const phrasesNow = await activeSpeechPhrases();
    expect(phrasesNow).toContain("QSC");
    expect(phrasesNow).toContain("Savant");

    const customer = await createCustomer(office, { brandId: adel.id, name: "Camille Calder" });
    const rows = await db.select().from(speechTerms);
    expect(rows.some((row) => row.phrase === customer.data.name)).toBe(false);
    expect(await activeSpeechPhrases()).toContain("Camille Calder");
  });

  it("keeps a saved language default separate from the session toggle and recognizes Spanish as es-US", async () => {
    const { tech } = await seedCompany();
    expect(await getDictationLanguage(tech.id)).toBe("en");
    expect(resolveDictationLanguage("en", null)).toBe("en");
    expect(resolveDictationLanguage("en", "es")).toBe("es");
    expect(await getDictationLanguage(tech.id)).toBe("en");
    await setDictationLanguage(tech, { language: "es" });
    expect(await getDictationLanguage(tech.id)).toBe("es");
    expect(resolveDictationLanguage("es", "en")).toBe("en");
    expect(await getDictationLanguage(tech.id)).toBe("es");
    expect(recognitionLanguage("es")).toBe("es-US");
    expect(recognitionLanguage("en")).toBe("en-US");
  });

  it("asks the cleanup model to translate Spanish without inventing facts or changing numbers", () => {
    const instructions = cleanupInstructions(["Crestron", "Lutron", "Camille Calder"], "es");
    expect(instructions).toContain("Translate it into English");
    expect(instructions).toContain("Do not invent facts.");
    expect(instructions).toContain("Do not change numbers, part numbers, or measurements.");
    expect(instructions).toContain("Crestron");
    expect(instructions).toContain("Lutron");
    expect(instructions).toContain("Camille Calder");
    expect(instructions).toContain("exactly as spelled");
  });

  it("keeps raw Spanish and marks it not translated when no API key is set", async () => {
    delete process.env.SPEECH_CLEANUP_API_KEY;
    process.env.SPEECH_CLEANUP = "on";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network"));
    const spanish = "cambié el teclado Crestron y corrí 40 pies de cable";
    const result = await finishDictation(spanish, phrases, "es");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.mode).toBe("passthrough");
    expect(result.translated).toBe(false);
    expect(result.language).toBe("es");
    expect(result.raw).toBe(spanish);
    expect(result.text).toBe(spanish);
    expect(NOT_TRANSLATED).toBe("Not translated");
  });

  it("stores the source language and the raw Spanish on the note", async () => {
    const { adel, tech } = await seedCompany();
    const [customer] = await db.insert(customers).values({ entityId: ADEL_ENTITY_ID, brandId: adel.id, name: "Camille Calder" }).returning();
    const [property] = await db
      .insert(properties)
      .values({ entityId: ADEL_ENTITY_ID, customerId: customer.id, label: "House", line1: "1 Main", city: "Naples", postalCode: "34102" })
      .returning();
    const [job] = await db
      .insert(jobs)
      .values({ entityId: ADEL_ENTITY_ID, number: 9001, customerId: customer.id, propertyId: property.id, brandId: adel.id, title: "Panel", status: "scheduled" })
      .returning();
    const start = new Date("2026-10-16T14:00:00.000Z");
    const [visit] = await db
      .insert(visits)
      .values({
        entityId: ADEL_ENTITY_ID,
        jobId: job.id,
        technicianId: tech.id,
        scheduledStart: start,
        scheduledEnd: new Date(start.getTime() + 60 * 60 * 1000),
        status: "scheduled",
      })
      .returning();
    const spanish = "el panel queda a 40 pies";
    await addVisitNote(tech, visit.id, { body: spanish, rawBody: spanish, sourceLanguage: "es" });
    const loaded = await getVisit(tech, visit.id);
    expect(loaded.data.notes[0]?.sourceLanguage).toBe("es");
    expect(loaded.data.notes[0]?.rawBody).toBe(spanish);
    expect(loaded.data.notes[0]?.body).toBe(spanish);
  });
});
