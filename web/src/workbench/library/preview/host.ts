import { age, duration, trimmed } from "@/core";
import { bands } from "@/model/gnss";
import { hostView, hostOf, nameOf, radioWord, sourceWords } from "@/workbench/hosts";
import { useBuildTrack } from "@/workbench/preview";
import { sceneOf } from "./common";
import type { ResourcePreview } from "./types";

export function useHostPreview(key: string, now: number): ResourcePreview | null {
  const host = hostOf(key);
  const view = host === undefined ? null : hostView(host, now);
  const submission = view?.submission ?? null;
  const track = useBuildTrack(submission?.source.buildId ?? null);
  if (host === undefined || view === null) return null;
  const { status, chip: state, window, epoch } = view;
  const station = host.snapshot?.station;
  const plan = status?.plan;
  const reference = station?.reference === "none" ? "Free-running clock"
    : station?.reference === "gpsdo" ? "GPSDO"
    : "External reference";
  const connection = host.link === "ok" ? "Connected"
    : host.link === "none" ? "Connecting…"
    : host.link === "token" ? "Token refused"
    : host.link === "origin" ? "Page origin not allowed"
    : "No status response";

  return {
    title: nameOf(host),
    kind: "Transmitter",
    description: host.record.address,
    created: null,
    status: {
      text: [state.word, `${state.lead}${state.figure}${state.tail}`].filter(Boolean).join(" · "),
      tone: view.cls === "onair" ? "active"
        : view.cls === "alarm" ? "error"
        : view.cls === "unknown" || view.cls === "armed" ? "warning"
        : "normal",
    },
    facts: [
      ["Connection", connection],
      ["Radio", station === undefined ? "Awaiting device information" : radioWord(host).replace(/^radio /, "")],
      ["Last status", host.lastOkAt === null ? "Not received" : `${age(now - host.lastOkAt)} ago`],
      ...(station === undefined ? [] : [
        ["Bands", bands(station.bands_hz)],
        ["Maximum gain", `${trimmed(station.max_gain_db)} dB`],
        ["Reference", reference],
      ] as const),
      ["Run", submission === null ? status?.config.label || "No run" : `${sourceWords(submission.source)} · run ${submission.run}`],
      ...(window === null ? [] : [["Duration", duration(window.durationMs)]] as const),
      ...(epoch === null || window === null ? [] : [["Progress", `${duration(epoch)} / ${duration(window.durationMs)}`]] as const),
      ...(plan == null ? [] : [
        ["Sample rate", `${trimmed(plan.rate_hz / 1e6)} Msps`],
        ["Center frequency", `${trimmed(plan.centre_hz / 1e6)} MHz`],
        ["Gain", `${trimmed(plan.gain_db)} dB`],
      ] as const),
    ],
    scene: track === null ? null : sceneOf(track, epoch ?? 0),
    mapCaption: submission === null ? "Run trajectory" : `Run ${submission.run} snapshot`,
    mapNote: null,
    issues: [
      ...(station !== undefined && host.link !== "ok" ? [{ error: false, message: "Device details show the last received status." }] : []),
      ...[host.alarm?.message, view.refusal?.message, view.sourceError, host.observationError]
        .filter((message): message is string => typeof message === "string" && message !== "")
        .map((message) => ({ error: true, message })),
    ],
    relations: [],
  };
}
