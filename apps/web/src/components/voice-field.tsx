"use client";

import { ghostClass, inputClass } from "@/components/ui";
import { buildSpeechGrammar, recognitionErrorKind, voiceAvailability, voiceStatusMessage } from "@adel/core/speech";
import { useEffect, useRef, useState } from "react";

type RecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  grammars?: unknown;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const STOP_EVENT = "adel-voice-stop";

export function VoiceField({
  name,
  rawName,
  phrases,
  multiline = false,
  placeholder,
  defaultValue = "",
  defaultRaw = "",
  required = false,
  rows = 3,
  label,
}: {
  name: string;
  rawName: string;
  phrases: string[];
  multiline?: boolean;
  placeholder?: string;
  defaultValue?: string;
  defaultRaw?: string;
  required?: boolean;
  rows?: number;
  label?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [raw, setRaw] = useState(defaultRaw);
  const [showOriginal, setShowOriginal] = useState(false);
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState("");
  const recognition = useRef<RecognitionLike | null>(null);

  useEffect(() => {
    const stop = () => recognition.current?.stop();
    window.addEventListener(STOP_EVENT, stop);
    return () => window.removeEventListener(STOP_EVENT, stop);
  }, []);

  async function applyTranscript(transcript: string) {
    try {
      const response = await fetch("/api/v1/speech/cleanup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      const payload = (await response.json()) as { text?: string; raw?: string; message?: string };
      if (!response.ok || !payload.text) {
        setValue(transcript);
        setRaw(transcript);
        setNotice(payload.message || "Couldn't clean that up. The words you said are in the field.");
        return;
      }
      setValue(payload.text);
      setRaw(payload.raw || transcript);
      setShowOriginal(false);
      setNotice("");
    } catch {
      setValue(transcript);
      setRaw(transcript);
      setNotice("Couldn't clean that up. The words you said are in the field.");
    }
  }

  function dictate() {
    if (listening) {
      recognition.current?.stop();
      setListening(false);
      return;
    }
    const scope = window as Window & { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
    if (voiceAvailability(scope) === "unsupported") {
      setNotice(voiceStatusMessage("unsupported"));
      return;
    }
    try {
      window.dispatchEvent(new Event(STOP_EVENT));
      const Ctor = scope.SpeechRecognition || scope.webkitSpeechRecognition;
      if (!Ctor) {
        setNotice(voiceStatusMessage("unsupported"));
        return;
      }
      const session = new Ctor();
      session.lang = "en-US";
      session.interimResults = false;
      session.continuous = false;
      const grammar = buildSpeechGrammar(phrases);
      const GrammarList = (window as Window & { SpeechGrammarList?: new () => { addFromString: (src: string, weight: number) => void }; webkitSpeechGrammarList?: new () => { addFromString: (src: string, weight: number) => void } }).SpeechGrammarList
        || (window as Window & { webkitSpeechGrammarList?: new () => { addFromString: (src: string, weight: number) => void } }).webkitSpeechGrammarList;
      if (grammar && GrammarList) {
        try {
          const list = new GrammarList();
          list.addFromString(grammar, 1);
          session.grammars = list;
        } catch {
          // Safari accepts recognition without phrase grammars.
        }
      }
      session.onresult = (event) => {
        const transcript = event.results[0]?.[0]?.transcript?.trim() ?? "";
        if (!transcript) {
          setNotice(voiceStatusMessage("failed"));
          return;
        }
        void applyTranscript(transcript);
      };
      session.onerror = (event) => {
        setListening(false);
        setNotice(voiceStatusMessage(recognitionErrorKind(event.error)));
      };
      session.onend = () => setListening(false);
      recognition.current = session;
      session.start();
      setListening(true);
      setNotice("Listening…");
    } catch {
      setListening(false);
      setNotice(voiceStatusMessage("unsupported"));
    }
  }

  const differs = Boolean(raw.trim() && raw.trim() !== value.trim());
  const fieldClass = inputClass;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        {label ? <span className="text-xs font-semibold text-muted">{label}</span> : <span />}
        <button className={`${ghostClass} shrink-0`} type="button" onClick={dictate} aria-pressed={listening}>
          {listening ? "Stop" : "Dictate"}
        </button>
      </div>
      {multiline ? (
        <textarea className={fieldClass} name={name} rows={rows} required={required} placeholder={placeholder} value={value} onChange={(event) => setValue(event.target.value)} />
      ) : (
        <input className={fieldClass} name={name} required={required} placeholder={placeholder} value={value} onChange={(event) => setValue(event.target.value)} />
      )}
      <input type="hidden" name={rawName} value={raw} />
      {notice ? <p className="text-xs text-muted">{notice}</p> : null}
      {differs ? (
        <div className="flex flex-wrap gap-3 text-xs">
          <button className="font-semibold text-pine" type="button" onClick={() => setShowOriginal((current) => !current)}>
            {showOriginal ? "Show cleaned" : "Show original"}
          </button>
          <button
            className="font-semibold text-pine"
            type="button"
            onClick={() => {
              setValue(raw);
              setShowOriginal(false);
            }}
          >
            Use original
          </button>
        </div>
      ) : null}
      {showOriginal && differs ? <p className="rounded-md bg-[#efe7d6] px-2 py-1 text-xs whitespace-pre-wrap">{raw}</p> : null}
    </div>
  );
}
