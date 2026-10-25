import { receptionistSandboxMessages, type ReceptionistSlot } from "@adel/db";
import { AppError } from "./errors";
import type { Tx } from "./db";

export type ReceptionistLanguage = "en" | "es";
export type ReceptionistChannel = "phone" | "web";

export type OutboundKind = "booking_confirmation" | "chat_confirmation" | "safety_sms" | "safety_call";

export type OutboundMessage = {
  entityId: string;
  conversationId: string;
  channel: "sms" | "voice" | "chat";
  kind: OutboundKind;
  toPhone: string | null;
  body: string;
  bodyEn: string;
};

export type ProviderReceipt = {
  id: string;
  provider: string;
  sandbox: boolean;
  delivered: boolean;
};

/**
 * SMS, voice handoff, and chat confirmation.
 * The sandbox implementation records the message and does not contact a carrier.
 * TwilioMessagingProvider is the plug-in point for a later approval. It refuses
 * to send, including when keys are present, so this repo cannot place a live call.
 */
export interface MessagingProvider {
  readonly name: string;
  deliver(message: OutboundMessage, tx: Tx): Promise<ProviderReceipt>;
}

export interface TranslationProvider {
  readonly name: string;
  toEnglish(text: string, language: ReceptionistLanguage): string;
}

const SPANISH_PHRASES: Array<[RegExp, string]> = [
  [/olor a quemado/gi, "burning smell"],
  [/no hay electricidad/gi, "no power"],
  [/no hay luz/gi, "no power"],
  [/sin luz/gi, "no power"],
  [/tomacorrientes/gi, "outlets"],
  [/tomacorriente/gi, "outlet"],
  [/enchufes/gi, "outlets"],
  [/enchufe/gi, "outlet"],
  [/no funciona/gi, "is not working"],
  [/chispas/gi, "sparks"],
  [/chispa/gi, "spark"],
  [/cocina/gi, "kitchen"],
  [/me dio un toque/gi, "I was shocked"],
  [/descarga/gi, "shock"],
  [/humo/gi, "smoke"],
  [/fuego/gi, "fire"],
  [/panel/gi, "panel"],
  [/en el/gi, "in the"],
  [/en la/gi, "in the"],
  [/de la/gi, "of the"],
  [/\bdel\b/gi, "of the"],
  [/\bhay\b/gi, "there is"],
  [/\by\b/gi, "and"],
];

export function translateSpanish(text: string) {
  let english = text;
  for (const [pattern, replacement] of SPANISH_PHRASES) {
    english = english.replace(pattern, replacement);
  }
  return english.replace(/\s+/g, " ").trim();
}

export class SandboxTranslationProvider implements TranslationProvider {
  readonly name = "sandbox";
  toEnglish(text: string, language: ReceptionistLanguage) {
    if (language === "en") return text;
    return translateSpanish(text);
  }
}

export class SandboxMessagingProvider implements MessagingProvider {
  readonly name = "sandbox";
  async deliver(message: OutboundMessage, tx: Tx): Promise<ProviderReceipt> {
    const [row] = await tx
      .insert(receptionistSandboxMessages)
      .values({
        entityId: message.entityId,
        conversationId: message.conversationId,
        channel: message.channel,
        kind: message.kind,
        toPhone: message.toPhone,
        body: message.body,
        bodyEn: message.bodyEn,
        provider: "sandbox",
        delivered: false,
      })
      .returning();
    return { id: row.id, provider: "sandbox", sandbox: true, delivered: false };
  }
}

export class TwilioMessagingProvider implements MessagingProvider {
  readonly name = "twilio";
  constructor(private readonly channel: "sms" | "voice") {}
  async deliver(): Promise<ProviderReceipt> {
    const sid = process.env.TWILIO_ACCOUNT_SID ?? "";
    const token = process.env.TWILIO_AUTH_TOKEN ?? "";
    const from = process.env.TWILIO_PHONE_NUMBER ?? "";
    if (!sid || !token || !from || /replace/i.test(`${sid}${token}${from}`)) {
      throw new AppError(503, "Twilio is not configured. Nothing was sent.", "live_provider_disabled");
    }
    // Alan has to approve a live adapter before this throw is replaced with a carrier call.
    // This channel is ${this.channel}. Do not add a fetch here until that approval.
    void this.channel;
    throw new AppError(503, "Live phone and SMS stay off until Alan approves this provider. Nothing was sent.", "live_provider_disabled");
  }
}

function providerChoice(name: string | undefined) {
  return (name ?? "sandbox").trim().toLowerCase();
}

export function messagingProvider(channel: "sms" | "voice" | "chat"): MessagingProvider {
  if (channel === "chat") return new SandboxMessagingProvider();
  const choice = providerChoice(channel === "sms" ? process.env.RECEPTIONIST_SMS_PROVIDER : process.env.RECEPTIONIST_VOICE_PROVIDER);
  if (choice === "twilio") return new TwilioMessagingProvider(channel);
  return new SandboxMessagingProvider();
}

export function translationProvider(): TranslationProvider {
  const choice = providerChoice(process.env.RECEPTIONIST_TRANSLATION_PROVIDER);
  if (choice === "sandbox" || choice === "") return new SandboxTranslationProvider();
  return new SandboxTranslationProvider();
}

const EMERGENCY_PATTERNS = [
  /\bno power\b/i,
  /\bpower(?:'s| is)? out\b/i,
  /\boutage\b/i,
  /\bsparks?\b/i,
  /\bburning smell\b/i,
  /\bsmell of (?:something )?burning\b/i,
  /\bsmoke\b/i,
  /\bshock(?:ed|ing)?\b/i,
  /\belectrocut/i,
  /\bfire\b/i,
  /\barcing\b/i,
  /\bhot panel\b/i,
  /\bpanel is hot\b/i,
  /\bsin luz\b/i,
  /\bno hay luz\b/i,
  /\bno hay electricidad\b/i,
  /\bchispas?\b/i,
  /\bolor a quemado\b/i,
  /\bhumo\b/i,
  /\bfuego\b/i,
  /\bdescarga\b/i,
  /\bme dio un toque\b/i,
  /\bquemad[oa]\b/i,
];

export function isElectricalEmergency(text: string) {
  return EMERGENCY_PATTERNS.some((pattern) => pattern.test(text));
}

export function safetyScript(language: ReceptionistLanguage, entityName: string) {
  const en = `This sounds like an electrical safety issue at ${entityName}. Stay clear of the panel, outlets, and any damaged wiring. Do not touch it. If you see fire or smoke, get everyone out. If someone is hurt or there is a fire, call emergency services. I'm alerting the on-call technician now.`;
  const es = `Esto parece un problema de seguridad eléctrica en ${entityName}. Manténgase alejado del panel, los tomacorrientes y cualquier cable dañado. No lo toque. Si ve fuego o humo, salga con todos. Si alguien está herido o hay un fuego, llame a los servicios de emergencia. Estoy avisando al técnico de guardia ahora.`;
  return language === "es" ? { body: es, bodyEn: en } : { body: en, bodyEn: en };
}

export type { ReceptionistSlot };
