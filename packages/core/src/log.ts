type Level = "debug" | "info" | "warn" | "error";

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): Level {
  const raw = (process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug")).toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  return "info";
}

function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/\b((?:sk|rk|pk)_(?:test|live)_)[A-Za-z0-9]+/g, "$1[redacted]")
      .replace(/\bwhsec_[A-Za-z0-9]+/g, "whsec_[redacted]")
      .replace(/\badel(?:dev)?_[A-Za-z0-9_-]{8,}/g, "adel_[redacted]");
  }
  if (value instanceof Error) return { name: value.name, message: redact(value.message) };
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redact(item)]));
  }
  return value;
}

export function log(level: Level, message: string, fields?: Record<string, unknown>) {
  if (RANK[level] < RANK[threshold()]) return;
  const safeMessage = String(redact(message));
  const safeFields = fields ? (redact(fields) as Record<string, unknown>) : undefined;
  const entry = { time: new Date().toISOString(), level, message: safeMessage, ...safeFields };
  const line =
    process.env.NODE_ENV === "production" || process.env.LOG_FORMAT === "json"
      ? JSON.stringify(entry)
      : `${entry.time} ${level} ${safeMessage}${safeFields ? ` ${JSON.stringify(safeFields)}` : ""}`;
  const writer = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  writer(line);
}
