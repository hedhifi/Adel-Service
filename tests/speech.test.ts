import { db, speechTerms } from "@adel/db";
import {
  AppError,
  activeSpeechPhrases,
  buildSpeechGrammar,
  cleanupInstructions,
  createCustomer,
  createSpeechTerm,
  deleteSpeechTerm,
  finishDictation,
  fuzzyCorrect,
  recognitionErrorKind,
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
});
