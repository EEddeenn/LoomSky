import type { Leap } from "@/model/gnss";

export type Window = Readonly<{ startGpsMs: number; durationMs: number; leapSeconds: number; leapChangeGpsMs: number | null; leapSecondsAfter: number }>;

export function packedLeap(window: Window): Leap {
  return { seconds: window.leapSeconds, change: window.leapChangeGpsMs, after: window.leapSecondsAfter };
}

export type SampleFormat = "IQ2" | "IQ4" | "IQ8" | "IQ16";
export type PositionFormat = "ECEF" | "LLA" | "KML";

export type PackedSummary = Readonly<{
  window: Window;
  samples: Readonly<{ format: SampleFormat; sampleRateHz: number; centerHz: number }> | null;
  elevationMaskDeg: number;
  observation: Readonly<{ intervalMs: number }> | null;
  position: Readonly<{ intervalMs: number; format: PositionFormat }> | null;
}>;
