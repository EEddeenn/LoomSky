const minus = "−";
const narrowSpace = " ";

export type Decimals = 0 | 1 | 2 | 3 | 4 | 6;

const number = (digits: Decimals) =>
  new Intl.NumberFormat("en", { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: "min2", signDisplay: "negative" });
const numbers: Record<Decimals, Intl.NumberFormat> = { 0: number(0), 1: number(1), 2: number(2), 3: number(3), 4: number(4), 6: number(6) };

const clockParts: Intl.DateTimeFormatOptions = { timeZone: "UTC", hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" };
const wholeClock = new Intl.DateTimeFormat("en-GB", clockParts);
const tenthsClock = new Intl.DateTimeFormat("en-GB", { ...clockParts, fractionalSecondDigits: 1 });

const kilobytes = new Intl.NumberFormat("en", { style: "unit", unit: "kilobyte", maximumFractionDigits: 0 });
const megabytes = new Intl.NumberFormat("en", { style: "unit", unit: "megabyte", minimumFractionDigits: 1, maximumFractionDigits: 1 });

function voiced(parts: Intl.NumberFormatPart[]): string {
  return parts.map((p) => (p.type === "minusSign" ? minus : p.type === "group" ? narrowSpace : p.value)).join("");
}

export function fixed(n: number, decimals: Decimals): string {
  return voiced(numbers[decimals].formatToParts(n));
}

export function group(n: number): string {
  return fixed(Math.trunc(n), 0);
}

export function typed(text: string | number): string {
  return String(text).trim().replace(/^-/, minus);
}

export function trimmed(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

export function clock(ms: number, tenths = false): string {
  return (tenths ? tenthsClock : wholeClock).format(ms);
}

export function stamp(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace(/(?:\.000)?Z$/, "");
}

const two = (n: number) => String(n).padStart(2, "0");

export function mmss(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

export function age(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 10) return `${s.toFixed(1)} s`;
  if (s < 60) return `${Math.floor(s)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${two(Math.floor(s % 60))} s`;
  return `${Math.floor(m / 60)} h ${two(m % 60)} min`;
}

export function offset(ms: number, millis = false): string {
  const v = Math.max(0, ms);
  const s = Math.floor(v / 1000);
  const text = `+${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
  return millis ? `${text}.${String(Math.floor(v % 1000)).padStart(3, "0")}` : text;
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  if (h > 0) return `${h} h${m > 0 ? ` ${two(m)} min` : ""}`;
  if (m > 0) return `${m} min${rest > 0 ? ` ${two(rest)} s` : ""}`;
  return `${rest} s`;
}

export function bytes(n: number): string {
  return n < 1e6 ? kilobytes.format(n / 1e3) : megabytes.format(n / 1e6);
}
