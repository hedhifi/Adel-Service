"use client";

import { useState } from "react";

type ChatMessage = { id: string; role: string; body: string };
type ChatSlot = { index: number; label: string; labelEs: string };
type ChatConversation = {
  id: string;
  entityName: string;
  language: "en" | "es";
  outcome: string;
  step: string;
};

export type ReceptionistChat = {
  conversation: ChatConversation;
  messages: ChatMessage[];
  slots: ChatSlot[];
};

export function ReceptionistWidget({ initial }: { initial: ReceptionistChat }) {
  const [conversation, setConversation] = useState(initial.conversation);
  const [messages, setMessages] = useState(initial.messages);
  const [slots, setSlots] = useState(initial.slots);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const spanish = conversation.language === "es";
  const closed = conversation.outcome === "booked" || conversation.outcome === "escalated" || conversation.outcome === "off" || conversation.step === "closed";

  async function send(value: string) {
    const trimmed = value.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError("");
    setText("");
    try {
      const response = await fetch(`/api/v1/public/receptionist/conversations/${conversation.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      const body = (await response.json()) as { data?: ReceptionistChat; message?: string };
      if (!response.ok || !body.data) {
        setError(body.message ?? (spanish ? "No se pudo enviar." : "That didn't send."));
        setText(trimmed);
        return;
      }
      setConversation(body.data.conversation);
      setMessages(body.data.messages);
      setSlots(body.data.slots ?? []);
    } catch {
      setError(spanish ? "No se pudo enviar." : "That didn't send.");
      setText(trimmed);
    } finally {
      setPending(false);
    }
  }

  return (
    <section data-testid="receptionist-widget" className="flex h-[640px] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-lg">
      <header className="bg-pine px-4 py-3 text-[#f6f1e6]">
        <p className="text-[10px] uppercase tracking-wide text-[#d7c7ae]">{spanish ? "Chat del sitio" : "Website chat"}</p>
        <h2 className="font-serif text-2xl leading-tight">{conversation.entityName}</h2>
        <p className="text-xs text-[#d7c7ae]">{spanish ? "Recepcionista · español" : "Receptionist · English"}</p>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" data-testid="chat-log">
        {messages.map((message) => (
          <p
            key={message.id}
            className={`max-w-[90%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
              message.role === "caller" ? "ml-auto bg-pine text-white" : "bg-[#f3efe6] text-ink"
            }`}
          >
            {message.body}
          </p>
        ))}
      </div>
      {slots.length > 0 && !closed ? (
        <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
          {slots.map((slot) => (
            <button
              key={slot.index}
              className="rounded-full border border-line bg-card px-3 py-1 text-left text-xs font-semibold text-pine"
              type="button"
              disabled={pending}
              onClick={() => send(String(slot.index))}
            >
              {slot.index}. {spanish ? slot.labelEs : slot.label}
            </button>
          ))}
        </div>
      ) : null}
      <form
        className="flex gap-2 border-t border-line p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send(text);
        }}
      >
        <label className="sr-only" htmlFor="receptionist-text">
          {spanish ? "Mensaje" : "Message"}
        </label>
        <input
          id="receptionist-text"
          className="min-w-0 flex-1 rounded-full border border-line px-3 py-2 text-sm outline-none focus:border-pine"
          value={text}
          disabled={pending || closed}
          placeholder={spanish ? "Escriba aquí" : "Type a message"}
          onChange={(event) => setText(event.target.value)}
        />
        <button className="rounded-full bg-pine px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" type="submit" disabled={pending || closed}>
          {spanish ? "Enviar" : "Send"}
        </button>
      </form>
      {error ? <p className="px-4 pb-3 text-xs text-danger">{error}</p> : null}
    </section>
  );
}
