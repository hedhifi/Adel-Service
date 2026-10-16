export function levenshtein(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + cost);
      previous = current;
    }
  }
  return row[b.length];
}

function coreToken(word: string) {
  return word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
}

function sameDigits(heard: string, phrase: string) {
  return heard.replace(/\D/g, "") === phrase.replace(/\D/g, "");
}

function closeEnough(heard: string, phrase: string) {
  const left = heard.toLowerCase();
  const right = phrase.toLowerCase();
  if (left === right) return true;
  if (right.length <= 4) return false;
  const distance = levenshtein(left, right);
  const limit = right.length <= 8 ? 2 : 3;
  return distance > 0 && distance <= limit && distance / right.length <= 0.34;
}

/** Replace near-misses with the canonical spelling. Numbers stay put unless the term itself contains the same digits. */
export function fuzzyCorrect(text: string, phrases: string[]) {
  const ranked = [...new Set(phrases.map((phrase) => phrase.trim()).filter(Boolean))].sort(
    (a, b) => b.split(/\s+/).length - a.split(/\s+/).length || b.length - a.length,
  );
  if (!ranked.length || !text.trim()) return text;
  const pieces = text.split(/(\s+)/);
  const wordAt: number[] = [];
  pieces.forEach((piece, index) => {
    if (piece.length && !/^\s+$/.test(piece)) wordAt.push(index);
  });
  const consumed = new Set<number>();
  for (const phrase of ranked) {
    const phraseWords = phrase.split(/\s+/).filter(Boolean);
    const width = phraseWords.length;
    for (let start = 0; start <= wordAt.length - width; start++) {
      if (Array.from({ length: width }, (_, offset) => start + offset).some((index) => consumed.has(index))) continue;
      const slice = wordAt.slice(start, start + width).map((index) => pieces[index]);
      const cores = slice.map(coreToken);
      if (cores.some((core) => !core)) continue;
      const heard = cores.join(" ");
      if (!sameDigits(heard, phrase) || !closeEnough(heard, phrase)) continue;
      const lead = slice[0].match(/^[^A-Za-z0-9]*/)?.[0] ?? "";
      const tail = slice[slice.length - 1].match(/[^A-Za-z0-9]*$/)?.[0] ?? "";
      pieces[wordAt[start]] = `${lead}${phrase}${tail}`;
      for (let offset = 1; offset < width; offset++) pieces[wordAt[start + offset]] = "";
      for (let offset = 0; offset < width; offset++) consumed.add(start + offset);
    }
  }
  return pieces
    .join("")
    .replace(/[^\S\n]{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

export function cleanupInstructions(phrases: string[]) {
  const list = phrases.length ? phrases.join(", ") : "(none)";
  return [
    "Clean this field note for an electrical and residential AV crew.",
    "Remove filler words, fix grammar, and tighten the phrasing into a clean written note.",
    "Do not invent facts.",
    "Do not change numbers, part numbers, or measurements.",
    "Preserve these spellings exactly and never correct them away:",
    list,
    "Return only the cleaned note, with no preamble.",
  ].join("\n");
}

export function buildSpeechGrammar(phrases: string[]) {
  const safe = phrases.map((phrase) => phrase.replace(/[^A-Za-z0-9 ]/g, "").trim()).filter(Boolean);
  if (!safe.length) return null;
  return `#JSGF V1.0; grammar terms; public <term> = ${safe.join(" | ")} ;`;
}

export function voiceAvailability(scope: { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }) {
  return scope.SpeechRecognition || scope.webkitSpeechRecognition ? "available" : "unsupported";
}

export function voiceStatusMessage(kind: "unsupported" | "denied" | "failed") {
  if (kind === "unsupported") return "Voice isn't available in this browser. You can still type.";
  if (kind === "denied") return "The microphone was blocked. You can still type.";
  return "Voice didn't catch that. You can still type.";
}

export function recognitionErrorKind(code: string) {
  if (code === "not-allowed" || code === "service-not-allowed") return "denied" as const;
  return "failed" as const;
}
