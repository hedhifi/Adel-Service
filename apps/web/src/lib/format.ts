import { zonedDateTime } from "@adel/db/zoned";

export function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function when(value: Date | string | null | undefined, timeZone = "America/New_York") {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function dayLabel(day: string, timeZone = "America/New_York") {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(zonedDateTime(day, "12:00", timeZone));
}

export function quoteNo(n: number) {
  return `Q-${n}`;
}

export function jobNo(n: number) {
  return `J-${n}`;
}

export function invoiceNo(n: number) {
  return `INV-${n}`;
}

export function billNo(n: number) {
  return `BILL-${n}`;
}

export function address(parts: { line1: string; line2?: string | null; city: string; state: string; postalCode: string }) {
  return [parts.line1, parts.line2, `${parts.city}, ${parts.state} ${parts.postalCode}`].filter(Boolean).join(", ");
}
