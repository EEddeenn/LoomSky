import { numberOf, type JsonRecord } from "@/core";

export const gpsEpochUnixMs = 315_964_800_000;
const weekMs = 604_800_000;
const dayMs = 86_400_000;
const moscowOffsetMs = 10_800_000;
const bdsOffsetMs = 14_000;
const glonassEpochUnixMs = Date.UTC(1996, 0, 1);
const minimumCalendarMs = -62_135_596_800_000;
const maximumCalendarMs = 253_402_300_800_000;

export type Leap = { seconds: number; change: number | null; after: number };

export const presentLeap: Leap = { seconds: 18, change: null, after: 18 };

function leapAt(leap: Leap, gps: number): number {
  return leap.change !== null && gps >= leap.change ? leap.after : leap.seconds;
}

export function unixOfGps(gps: number, leap: Leap): number {
  return gps + gpsEpochUnixMs - leapAt(leap, gps) * 1000;
}

export function gpsOfUnix(unix: number, leap: Leap): number {
  const since = unix - gpsEpochUnixMs;
  const seconds = leap.change !== null && since >= leap.change - leap.after * 1000 ? leap.after : leap.seconds;
  return since + seconds * 1000;
}

export function gpsNow(leap: Leap): number {
  return gpsOfUnix(Date.now(), leap);
}

export const timeTypes = ["UTC", "GPS", "Galileo", "BDS", "GLONASS"] as const;
export type TimeType = (typeof timeTypes)[number];

export function typeOf(time: JsonRecord | undefined): TimeType {
  return timeTypes.find((t) => t === time?.type) ?? "UTC";
}

const weekOffset: Record<"GPS" | "Galileo" | "BDS", number> = { GPS: 0, Galileo: 1024, BDS: 1356 };

function calendarMs(year: number, month: number, date: number, hour: number, minute: number, second: number): number | null {
  if (
    ![year, month, date, hour, minute].every(Number.isInteger) ||
    year < 1 || year > 9999 ||
    month < 1 || month > 12 ||
    hour < 0 || hour > 23 ||
    minute < 0 || minute > 59 ||
    !(second >= 0 && second < 60)
  ) return null;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = month === 2 ? (leapYear ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  if (date < 1 || date > days) return null;
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, date);
  value.setUTCHours(hour, minute, 0, 0);
  return value.getTime() + second * 1000;
}

export function parseStamp(text: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(text.trim());
  return match === null ? null : calendarMs(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
}

export function gpsOfTime(time: JsonRecord, leap: Leap): number | null {
  const type = typeOf(time);
  const field = (key: string) => numberOf(time[key]) ?? Number.NaN;
  const second = field("second");
  let gps: number;
  if (type === "GPS" || type === "Galileo" || type === "BDS") {
    gps = (field("week") + weekOffset[type]) * weekMs + second * 1000 + (type === "BDS" ? bdsOffsetMs : 0);
  } else if (type === "GLONASS") {
    gps = gpsOfUnix(glonassEpochUnixMs + ((field("leapYear") - 1) * 1461 + field("day") - 1) * dayMs + second * 1000 - moscowOffsetMs, leap);
  } else {
    const ms = calendarMs(field("year"), field("month"), field("day"), field("hour"), field("minute"), second);
    if (ms === null) return null;
    gps = gpsOfUnix(ms, leap);
  }
  return gpsInCalendarRange(gps, leap) ? gps : null;
}

export function gpsInCalendarRange(gps: number, leap: Leap): boolean {
  return Number.isFinite(gps) && timeTypes.every((type) => {
    const calendar = scaleMs(type, gps, leap);
    return calendar >= minimumCalendarMs && calendar < maximumCalendarMs;
  });
}

export function timeOf(type: TimeType, gps: number, leap: Leap): Record<string, number | string> {
  if (type === "GPS" || type === "Galileo" || type === "BDS") {
    const scaleTimeMs = type === "BDS" ? gps - bdsOffsetMs : gps;
    const weekNumber = Math.floor(scaleTimeMs / weekMs);
    return { type, week: weekNumber - weekOffset[type], second: (scaleTimeMs - weekNumber * weekMs) / 1000 };
  }
  const unix = unixOfGps(gps, leap);
  if (type === "GLONASS") {
    const elapsedMs = unix + moscowOffsetMs - glonassEpochUnixMs;
    const cycleIndex = Math.floor(elapsedMs / (1461 * dayMs));
    const cycleMs = elapsedMs - cycleIndex * 1461 * dayMs;
    return { type, leapYear: cycleIndex + 1, day: Math.floor(cycleMs / dayMs) + 1, second: (cycleMs % dayMs) / 1000 };
  }
  const date = new Date(unix);
  return {
    type,
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds() + date.getUTCMilliseconds() / 1000,
  };
}

export function scaleMs(type: TimeType, gps: number, leap: Leap): number {
  if (type === "GPS" || type === "Galileo") return gps + gpsEpochUnixMs;
  if (type === "BDS") return gps + gpsEpochUnixMs - bdsOffsetMs;
  const unix = unixOfGps(gps, leap);
  return type === "GLONASS" ? unix + moscowOffsetMs : unix;
}

export function gpsOfScale(type: TimeType, ms: number, leap: Leap): number {
  if (type === "GPS" || type === "Galileo") return ms - gpsEpochUnixMs;
  if (type === "BDS") return ms - gpsEpochUnixMs + bdsOffsetMs;
  return gpsOfUnix(type === "GLONASS" ? ms - moscowOffsetMs : ms, leap);
}
