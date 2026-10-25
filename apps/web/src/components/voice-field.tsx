"use client";

import { buttonClass, ghostClass, inputClass } from "@/components/ui";
import { setDictationLanguageAction } from "@/server/actions";
import {
  NOT_TRANSLATED,
  buildSpeechGrammar,
  recognitionErrorKind,
  recognitionLanguage,
  voiceAvailability,
  voiceStatusMessage,
  type DictationLanguage,
} from "@adel/core/speech";
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
const LANGUAGE_EVENT = "adel-dictation-language";
const LANGUAGE_KEY = "adel-dictation-language";

export function VoiceField({
  name,
  rawName,
  languageName = "sourceLanguage",
  phrases,
  defaultLanguage = "en",
  saveDefault = false,
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
  languageName?: string;
  phrases: string[];
  defaultLanguage?: DictationLanguage;
  saveDefault?: boolean;
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
  const [untranslated, setUntranslated] = useState(false);
  const [savedDefault, setSavedDefault] = useState<DictationLanguage>(defaultLanguage);
  const [sessionLanguage, setSessionLanguage] = useState<DictationLanguage | null>(null);
  const [dictatedLanguage, setDictatedLanguage] = useState("");
  const recognition = useRef<RecognitionLike | null>(null);
  const language = sessionLanguage ?? savedDefault;

  useEffect(() => {
    const stop = () => recognition.current?.stop();
    const stored = sessionStorage.getItem(LANGUAGE_KEY);
    if (stored === "en" || stored === "es") setSessionLanguage(stored);
    const onLanguage = (event: Event) => {
      const detail = (event as CustomEvent<DictationLanguage>).detail;
      if (detail === "en" || detail === "es") setSessionLanguage(detail);
    };
    window.addEventListener(STOP_EVENT, stop);
    window.addEventListener(LANGUAGE_EVENT, onLanguage);
    return () => {
      window.removeEventListener(STOP_EVENT, stop);
      window.removeEventListener(LANGUAGE_EVENT, onLanguage);
    };
  }, []);

  function chooseLanguage(next: DictationLanguage) {
    sessionStorage.setItem(LANGUAGE_KEY, next);
    window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: next }));
  }

  async function applyTranscript(transcript: string, spoken: DictationLanguage) {
    try {
      const response = await fetch("/api/v1/speech/cleanup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript, language: spoken }),
      });
      const payload = (await response.json()) as { text?: string; raw?: string; message?: string; translated?: boolean; language?: string };
      setDictatedLanguage(spoken);
      if (!response.ok || !payload.text) {
        setValue(transcript);
        setRaw(transcript);
        setUntranslated(spoken === "es");
        setNotice(payload.message || "Couldn't clean that up. The words you said are in the field.");
        return;
      }
      setValue(payload.text);
      setRaw(payload.raw || transcript);
      setUntranslated(spoken === "es" && payload.translated === false);
      setShowOriginal(false);
      setNotice("");
    } catch {
      setDictatedLanguage(spoken);
      setValue(transcript);
      setRaw(transcript);
      setUntranslated(spoken === "es");
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
      const spoken = language;
      const session = new Ctor();
      session.lang = recognitionLanguage(spoken);
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
        void applyTranscript(transcript, spoken);
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        {label ? <span className="text-xs font-semibold text-muted">{label}</span> : <span />}
        <span className="flex items-center gap-1">
          <button className={`${language === "en" ? buttonClass : ghostClass} px-2 py-1`} type="button" aria-pressed={language === "en"} onClick={() => chooseLanguage("en")}>
            English
          </button>
          <button className={`${language === "es" ? buttonClass : ghostClass} px-2 py-1`} type="button" aria-pressed={language === "es"} onClick={() => chooseLanguage("es")}>
            Spanish
          </button>
          <button className={`${ghostClass} shrink-0`} type="button" onClick={dictate} aria-pressed={listening}>
            {listening ? "Stop" : "Dictate"}
          </button>
        </span>
      </div>
      {multiline ? (
        <textarea className={fieldClass} name={name} rows={rows} required={required} placeholder={placeholder} value={value} onChange={(event) => setValue(event.target.value)} />
      ) : (
        <input className={fieldClass} name={name} required={required} placeholder={placeholder} value={value} onChange={(event) => setValue(event.target.value)} />
      )}
      <input type="hidden" name={rawName} value={raw} />
      <input type="hidden" name={languageName} value={dictatedLanguage} />
      {untranslated ? <p className="text-xs font-semibold text-copper">{NOT_TRANSLATED}</p> : null}
      {saveDefault && language !== savedDefault ? (
        <button
          className="text-xs font-semibold text-pine"
          type="button"
          onClick={() => {
            void setDictationLanguageAction(language).then(() => setSavedDefault(language));
          }}
        >
          Save as my default
        </button>
      ) : null}
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
