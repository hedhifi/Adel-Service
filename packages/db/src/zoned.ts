function zoneParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((part) => [part.type, part.value]));
  if (parts.hour === "24") parts.hour = "00";
  return parts;
}

export function timeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = zoneParts(date, timeZone);
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUTC - date.getTime();
}

/** Interpret a calendar day and HH:mm as wall time in `timeZone`. */
export function zonedDateTime(day: string, time: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !timeMatch) {
    throw new Error("Use a date like 2026-10-16 and a time like 09:30.");
  }
  const utcGuess = new Date(`${day}T${time}:00.000Z`);
  const offset = timeZoneOffsetMs(utcGuess, timeZone);
  const first = new Date(utcGuess.getTime() - offset);
  const corrected = timeZoneOffsetMs(first, timeZone);
  return corrected === offset ? first : new Date(utcGuess.getTime() - corrected);
}

export function companyToday(timeZone: string, now = new Date()) {
  const parts = zoneParts(now, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function shiftDay(day: string, delta: number) {
  const [year, month, date] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date + delta));
  return shifted.toISOString().slice(0, 10);
}

/** Add calendar months, clamping the day to the target month (Jan 31 plus one month is Feb 28). */
export function addMonths(day: string, months: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new Error("Use a date like 2026-10-16.");
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1 + months;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const dayOfMonth = Math.min(Number(match[3]), lastDay);
  return new Date(Date.UTC(targetYear, targetMonth, dayOfMonth)).toISOString().slice(0, 10);
}

export function formatDateTimeLocal(date: Date, timeZone: string) {
  const parts = zoneParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
