import { addMonths, shiftDay } from "@adel/db/zoned";

export type NamedFrequency = "monthly" | "quarterly" | "annual" | "custom";
export type IntervalUnit = "day" | "week" | "month";

export function weekdayIndex(day: string) {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

function iso(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const delta = (weekday - first.getUTCDay() + 7) % 7;
  return iso(year, month, 1 + delta + (n - 1) * 7);
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number) {
  const last = new Date(Date.UTC(year, month, 0));
  const delta = (last.getUTCDay() - weekday + 7) % 7;
  return iso(year, month, last.getUTCDate() - delta);
}

function observedFixed(day: string) {
  const weekday = weekdayIndex(day);
  if (weekday === 6) return shiftDay(day, -1);
  if (weekday === 0) return shiftDay(day, 1);
  return day;
}

/** US federal holidays, with Saturday/Sunday fixed dates observed on Friday/Monday. */
export function federalHolidays(year: number) {
  return new Set([
    observedFixed(`${year}-01-01`),
    nthWeekdayOfMonth(year, 1, 1, 3),
    nthWeekdayOfMonth(year, 2, 1, 3),
    lastWeekdayOfMonth(year, 5, 1),
    observedFixed(`${year}-06-19`),
    observedFixed(`${year}-07-04`),
    nthWeekdayOfMonth(year, 9, 1, 1),
    nthWeekdayOfMonth(year, 10, 1, 2),
    observedFixed(`${year}-11-11`),
    nthWeekdayOfMonth(year, 11, 4, 4),
    observedFixed(`${year}-12-25`),
  ]);
}

/**
 * Move a date that lands on a weekend or federal holiday forward to the next
 * weekday that is not a holiday. Saturday does not jump backward onto Friday.
 */
export function shiftOffHoliday(day: string) {
  const year = Number(day.slice(0, 4));
  const holidays = new Set<string>();
  for (const candidate of [year - 1, year, year + 1]) {
    for (const holiday of federalHolidays(candidate)) holidays.add(holiday);
  }
  let cursor = day;
  let shifted = false;
  for (let guard = 0; guard < 14; guard += 1) {
    const weekend = weekdayIndex(cursor) === 0 || weekdayIndex(cursor) === 6;
    if (!weekend && !holidays.has(cursor)) break;
    cursor = shiftDay(cursor, 1);
    shifted = true;
  }
  return { occursOn: cursor, shifted };
}

export function billingMonths(frequency: NamedFrequency, intervalCount: number) {
  if (frequency === "monthly") return 1;
  if (frequency === "quarterly") return 3;
  if (frequency === "annual") return 12;
  return intervalCount;
}

export function occurrenceDate(
  anchor: string,
  index: number,
  frequency: NamedFrequency,
  intervalCount: number,
  intervalUnit: IntervalUnit,
) {
  if (frequency === "monthly") return addMonths(anchor, index);
  if (frequency === "quarterly") return addMonths(anchor, index * 3);
  if (frequency === "annual") return addMonths(anchor, index * 12);
  if (intervalUnit === "day") return shiftDay(anchor, index * intervalCount);
  if (intervalUnit === "week") return shiftDay(anchor, index * intervalCount * 7);
  return addMonths(anchor, index * intervalCount);
}

export function daysBetween(from: string, to: string) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}
