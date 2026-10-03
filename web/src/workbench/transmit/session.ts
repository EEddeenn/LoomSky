import { packedLeap } from "@/model/bundle";
import { createStore, offset } from "@/core";
import { gpsOfUnix } from "@/model/gnss";
import type { SavedScenarioBuild } from "@/workbench/documents/scenario/builds";

import { activityOf, hostView, hostNow, hostOf, hosts, mayAir, type Host } from "@/workbench/hosts";
import { closePageSession, createPageSession, isPageSession, noteInteraction, type PageSession } from "@/workbench/navigation";
import type { TransmissionReview } from "./review";
import { gainIsInvalid, parseReplayOffset, resolveConfiguration, sourceIssue, type ResolvedConfiguration } from "./configuration";

export type TransmissionSession = Readonly<{
  id: number;
  source: SavedScenarioBuild;
  host: string | null;
  mode: "live" | "replay";
  replayDraft: string;
  gain: string;
  reviewError: string | null;
  review: TransmissionReview | null;
  sending: boolean;
}>;

type TransmissionState =
  | { kind: "closed" }
  | { kind: "opening"; owner: PageSession }
  | { kind: "configuring"; owner: PageSession; session: TransmissionSession };

export const transmission = createStore<{ state: TransmissionState }>({ state: { kind: "closed" } });

export function closeTransmission(): void {
  const state = transmission.get().state;
  if (state.kind !== "closed") closePageSession(state.owner);
}

export function beginOpening(): PageSession {
  noteInteraction();
  closeTransmission();
  const owner = createPageSession({ onClose: () => {
    const state = transmission.get().state;
    if (state.kind !== "closed" && state.owner === owner) transmission.set({ state: { kind: "closed" } });
  } });
  transmission.set({ state: { kind: "opening", owner } });
  return owner;
}

export function isOpening(owner: PageSession): boolean {
  const state = transmission.get().state;
  return state.kind === "opening" && state.owner === owner && isPageSession(owner);
}

export function finishOpening(owner: PageSession): void {
  if (isOpening(owner)) closePageSession(owner);
}

export function isTransmissionSession(session: TransmissionSession): boolean {
  return transmissionOwner(session) !== null;
}

export function transmissionOwner(session: TransmissionSession): PageSession | null {
  const state = transmission.get().state;
  return state.kind === "configuring" && state.session.id === session.id && isPageSession(state.owner) ? state.owner : null;
}

export function installTransmission(owner: PageSession, source: SavedScenarioBuild, host: Host | undefined, replayFromMs: number, gain = host?.record.gain ?? ""): void {
  const state = transmission.get().state;
  if (state.kind === "closed" || state.owner !== owner || !isPageSession(owner)) return;
  const window = source.window;
  const now = Date.now();
  const live = gpsOfUnix(host === undefined ? now : hostNow(host, now), packedLeap(window)) < window.startGpsMs + window.durationMs;
  const replayMs = Math.round(Math.min(Math.max(replayFromMs, 0), Math.max(0, window.durationMs - 1)));
  transmission.set({ state: { kind: "configuring", owner, session: { id: owner.id, source, host: host?.key ?? null, mode: live ? "live" : "replay", replayDraft: offset(replayMs, true), gain, reviewError: null, review: null, sending: false } } });
}

export function updateTransmission(session: TransmissionSession, patch: Partial<Pick<TransmissionSession, "host" | "mode" | "gain" | "replayDraft" | "reviewError" | "review" | "sending">>): void {
  const state = transmission.get().state;
  if (state.kind === "configuring" && state.session.id === session.id) transmission.set({ state: { ...state, session: { ...state.session, reviewError: null, review: null, ...patch } } });
}

export function chooseTransmissionHost(session: TransmissionSession, key: string): void {
  const host = hostOf(key);
  if (host === undefined || sourceIssue(host, session.source, Date.now()) !== "") return;
  updateTransmission(session, { host: key, gain: session.gain === "" ? host.record.gain ?? "" : session.gain });
}

export function setTransmissionMode(session: TransmissionSession, mode: TransmissionSession["mode"]): void {
  updateTransmission(session, { mode });
}

export function setTransmissionGain(session: TransmissionSession, gain: string): void {
  updateTransmission(session, { gain });
}

export function setTransmissionReplay(session: TransmissionSession, replayDraft: string): void {
  if (!isTransmissionSession(session)) return;
  updateTransmission(session, { replayDraft });
}

export function setReviewError(session: TransmissionSession, reviewError: string): void {
  updateTransmission(session, { reviewError });
}

export function configurationOf(session: TransmissionSession, now: number) {
  const { source } = session;
  const host = hostOf(session.host);
  const list = hosts.get().list;
  const parsedReplay = parseReplayOffset(session.replayDraft);
  const replayMs = parsedReplay !== null && parsedReplay < source.window.durationMs ? parsedReplay : null;
  const gainDb = session.gain.trim() === "" ? null : Number(session.gain);
  const config: ResolvedConfiguration = gainDb === null
    ? { kind: "blocked", issue: "Enter a gain." }
    : session.mode === "replay" && replayMs === null
      ? { kind: "blocked", issue: "Enter an offset within the scenario window." }
      : resolveConfiguration(host, source, { gainDb, replayMs: session.mode === "live" ? null : replayMs }, now);
  const others = list.filter((candidate) => candidate !== host && candidate.snapshot !== null &&
    hostView(candidate, now).submission?.source.scenarioId === source.resourceId && mayAir(activityOf(candidate, now)));
  return {
    host,
    choices: list.map((candidate) => ({ host: candidate, issue: sourceIssue(candidate, source, now) })),
    gpsNow: gpsOfUnix(host === undefined ? now : hostNow(host, now), packedLeap(source.window)),
    replayMs,
    startMs: session.mode === "live" ? 0 : replayMs,
    gainIssue: gainDb !== null && gainIsInvalid(host, gainDb),
    others,
    othersLive: others.filter((candidate) => (candidate.snapshot?.status?.config.replay_ms ?? null) === null),
    config,
  };
}
