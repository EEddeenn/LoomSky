import { duration, stamp, trimmed } from "@/core";
import { scaleMs, type Leap, type TimeType } from "@/model/gnss";
import type { ScenarioFacts, ScenarioOutputs } from "@/model/scenario";

export function scenarioWindowText(window: { startGpsMs: number; durationMs: number; leap: Leap } | null, scale: TimeType): string {
  if (window === null) return "";
  return `${stamp(scaleMs(scale, window.startGpsMs, window.leap)).slice(11, 16)} ${scale} · ${duration(window.durationMs)}`;
}

export function scenarioSignalsText(facts: Pick<ScenarioFacts, "signals" | "sampleFormat" | "sampleRateMsps">): string {
  return [
    facts.signals.join(" ") || "None",
    facts.sampleFormat === null || facts.sampleFormat === "IQ16" ? "" : facts.sampleFormat,
    facts.sampleRateMsps === null ? "" : `${trimmed(facts.sampleRateMsps)} Msps`,
  ].filter(Boolean).join(" · ");
}

export function scenarioOutputsText(outputs: ScenarioOutputs): string {
  return [
    outputs.observation === null ? "" : `Observation ${trimmed(outputs.observation.intervalSeconds)} s`,
    outputs.position === null ? "" : `${outputs.position.format ?? ""} ${trimmed(outputs.position.intervalSeconds)} s`,
  ].filter(Boolean).join(" · ") || "No outputs";
}
