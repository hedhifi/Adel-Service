"use client";

import { useState } from "react";

export function DictatedText({ text, raw }: { text: string; raw?: string | null }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const differs = Boolean(raw && raw.trim() && raw.trim() !== text.trim());
  return (
    <div>
      <p className="whitespace-pre-wrap">{showOriginal && raw ? raw : text}</p>
      {differs ? (
        <button className="mt-1 text-xs font-semibold text-pine" type="button" onClick={() => setShowOriginal((current) => !current)}>
          {showOriginal ? "Show cleaned" : "Show original"}
        </button>
      ) : null}
    </div>
  );
}
