import type { Diagnostic } from "@/model/document";
import type { TrajectoryInspection } from "./inspection";

type TrackData = {
  diagnostics: Diagnostic[];
  duration: number;
  inspection: TrajectoryInspection | null;
  states: Float64Array<ArrayBuffer>;
};

export type GeneratedTrack = TrackData & {
  error: "";
  pht: Uint8Array<ArrayBuffer>;
};

export type Track = GeneratedTrack | (TrackData & { error: string; pht: null });
export const stateWidth = 6;

type State = { t: number; lat: number; lon: number; alt: number; speed: number; course: number };

function stateOf(s: Float64Array, i: number): State {
  const at = (k: number) => s[i * stateWidth + k] ?? Number.NaN;
  return { t: at(0), lat: at(1), lon: at(2), alt: at(3), speed: at(4), course: at(5) };
}

export function stateAt(track: Track, seconds: number): State | null {
  const s = track.states;
  const n = s.length / stateWidth;
  if (n === 0) return null;
  const first = stateOf(s, 0);
  const last = stateOf(s, n - 1);
  if (seconds < first.t) return first;
  if (seconds >= last.t) return last;

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((s[mid * stateWidth] ?? 0) <= seconds) lo = mid;
    else hi = mid;
  }

  const a = stateOf(s, lo);
  const b = stateOf(s, hi);
  const f = (seconds - a.t) / (b.t - a.t);
  const mix = (x: number, y: number) => x + (y - x) * f;
  const longitude = a.lon + (((b.lon - a.lon + 540) % 360) - 180) * f;
  const turn = Number.isNaN(a.course) ? b.course : Number.isNaN(b.course) ? a.course : a.course + (((b.course - a.course + 180) % 360 + 360) % 360 - 180) * f;
  return { t: seconds, lat: mix(a.lat, b.lat), lon: ((longitude + 540) % 360) - 180, alt: mix(a.alt, b.alt), speed: mix(a.speed, b.speed), course: turn };
}

export function headingAt(track: Track, seconds: number): number {
  const here = stateAt(track, seconds);
  if (here !== null && !Number.isNaN(here.course)) return here.course;
  for (let i = track.states.length / stateWidth - 1; i >= 0; i--) {
    const s = stateOf(track.states, i);
    if (s.t <= seconds && !Number.isNaN(s.course)) return s.course;
  }
  return Number.NaN;
}

export function moves(track: Track): boolean {
  for (let i = 0; i < track.states.length / stateWidth; i++) if (stateOf(track.states, i).speed >= 0.05) return true;
  return false;
}
