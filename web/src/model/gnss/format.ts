import { clock, fixed } from "@/core";
import { gpsEpochUnixMs, unixOfGps, type Leap } from "./time";

export function gpsClock(gps: number, tenths = false): string {
  return clock(gps + gpsEpochUnixMs, tenths);
}

export function utcClock(gps: number, leap: Leap, tenths = false): string {
  return clock(unixOfGps(gps, leap), tenths);
}

export function gpsDate(gps: number): string {
  return new Date(gps + gpsEpochUnixMs).toISOString().slice(0, 10);
}

export function bands(list: readonly (readonly [number, number])[]): string {
  return `${list.map(([low, high]) => `${fixed(low / 1e6, 0)}–${fixed(high / 1e6, 0)}`).join(", ")} MHz`;
}
