import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useStore } from "@/core";
import { packedLeap } from "@/model/bundle";
import { gpsOfUnix } from "@/model/gnss";
import { obsCommands, type RunTruth, type SubmissionRecord } from "@/model/host";
import type { ObsCommand, EpochRange } from "@/model/observation";
import { previewOwnerKey, type PreviewLane, type PreviewSource } from "@/model/preview";
import type { Track } from "@/model/trajectory";
import { immutableCopy } from "@/model/version";
import { useNow } from "@/workbench/clock";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import type { TrajectoryDoc } from "@/workbench/documents/trajectory";
import { airingHosts, commandWords, hosts, hostView, nameOf, sourceWords, type Host } from "@/workbench/hosts";
import { useBuildTrack } from "./run-track";
import { PreviewSession, type PreviewInput } from "./session";

const scenarioSessions = new WeakMap<ScenarioDoc, PreviewSession>();

function laneOf(host: Host, now: number): PreviewLane {
  const view = hostView(host, now);
  const status = view.status;
  const sent = view.cls === "unknown" ? status?.sent ?? null : view.sentEpoch;
  const faultRun = host.snapshot === null ? "" : `${host.snapshot.boot}|${host.snapshot.run}`;
  return {
    key: `${host.key}:${host.snapshot?.boot ?? ""}:${host.snapshot?.run ?? ""}`,
    label: nameOf(host), state: view.cls, epochMs: view.cls === "unknown" ? sent : view.epoch,
    sentMs: sent, firstMs: status?.first ?? 0,
    unknownUntilMs: view.cls === "unknown" && sent !== null ? Math.min(view.window?.durationMs ?? sent, sent + Math.max(0, now - (host.lastOkAt ?? now))) : null,
    replay: status?.config.replay_ms != null,
    commands: (status?.commands ?? []).flatMap((line) => line.applied !== null && "epoch" in line.applied ? [{ epochMs: line.applied.epoch, label: commandWords(line.command) }] : []),
    faults: host.faultRun === faultRun ? host.faults.map((fault) => ({ epochMs: fault.epoch, label: fault.kind })) : [],
    end: (status?.state === "ended" || view.cls === "alarm") && status?.sent != null ? {
      epochMs: status.sent,
      label: view.cls === "alarm" ? host.alarm?.kind ?? "" : status.outcome === null ? "" : Object.keys(status.outcome)[0] ?? "",
      alarm: view.cls === "alarm",
    } : null,
  };
}

function sourceOfRun(submission: SubmissionRecord, hostKey: string, registrationId: string | null, commands: ObsCommand[], range?: EpochRange): PreviewSource {
  return Object.freeze({
    identity: immutableCopy({ kind: "run", run: {
      hostKey, registrationId, address: submission.address, boot: submission.boot, sequence: submission.run,
      submissionKey: submission.key, buildId: submission.source.buildId, engineIdentity: submission.source.engineIdentity, digest: submission.digest,
    } } as const),
    key: `run:${submission.key}`, label: `${sourceWords(submission.source)} · run ${submission.run} snapshot`,
    origin: submission.address, digest: submission.digest, bundle: submission.bundle,
    summary: immutableCopy(submission.summary), run: submission.key, commands: immutableCopy(commands), scenario: submission.texts.scenario,
    range: immutableCopy(range ?? { first: 0, end: submission.summary.window.durationMs + 1 }), stale: false, current: true,
  });
}

function scenarioSource(doc: ScenarioDoc): PreviewSource | null {
  const latest = doc.view?.lastSuccessful ?? null;
  if (latest === null) return null;
  const current = latest === doc.view?.currentResult;
  return Object.freeze({
    identity: immutableCopy({ kind: "scenario", id: doc.id, revision: latest.rev, digest: latest.digest } as const),
    key: previewOwnerKey({ kind: "scenario", id: doc.id }),
    label: `${doc.id} · ${current ? "Working copy" : "Last passed checks"}`,
    digest: latest.digest, bundle: latest.bundle, summary: immutableCopy(latest.summary), run: "", commands: [],
    scenario: latest.scenario, range: { first: 0, end: latest.window.durationMs + 1 }, stale: latest.rev !== doc.editor.rev, current,
  });
}

function scenarioInput(doc: ScenarioDoc, now: number, source: PreviewSource | null): PreviewInput {
  const window = source === null ? null : { ...source.summary.window, leap: packedLeap(source.summary.window) };
  return {
    scope: `Scenario ${doc.id}`, nowMs: now, source, window, track: doc.view?.lastSuccessful?.track ?? null,
    lanes: source?.current !== true ? [] : airingHosts(doc.id, now).filter((host) => hostView(host, now).submission?.digest === source.digest).map((host) => laneOf(host, now)),
    nowGpsMs: window === null ? null : gpsOfUnix(now, window.leap),
    note: source === null && doc.editor.status === "errors" ? { level: "error", message: "Fix scenario errors to preview." } : null,
  };
}

function hostInput(host: Host, now: number, source: PreviewSource | null, track: Track | null): PreviewInput {
  const view = hostView(host, now);
  const { status, cls } = view;
  const known = cls !== "unknown";
  const window = view.window === null ? null : { ...view.window, leap: view.leap };
  const note: PreviewInput["note"] = source === null && status !== null ? {
    level: view.sourceError === null ? "warning" : "error",
    message: view.sourceError ?? "No matching submitted bundle in this browser. See Run for host status.",
  } : !known && source !== null ? {
    level: "warning", message: "Host status unknown. Progress and applied commands are from the last confirmed status.",
  } : null;
  return {
    scope: `Host ${nameOf(host)}`, nowMs: now, source, track, window, note,
    lanes: status === null ? [] : [laneOf(host, now)],
    nowGpsMs: window === null || status?.config.replay_ms != null ? null : gpsOfUnix(now, window.leap),
    liveRun: source?.identity.kind === "run" ? source.identity.run : null,
    followEpochMs: status === null ? null : known ? view.epoch : status.sent,
    live: known && (cls === "onair" || cls === "armed"),
    canFollow: status !== null && (cls === "onair" || cls === "armed" || cls === "unknown"),
    canCommand: source !== null && known && (cls === "onair" || cls === "armed"), registrationId: host.record.id,
  };
}

function submissionInput(submission: SubmissionRecord, truth: RunTruth | null): PreviewInput {
  const matched = truth !== null && truth.key === submission.key && truth.digest === submission.digest
    && truth.run.boot === submission.boot && truth.run.sequence === submission.run;
  const source = !matched ? null : sourceOfRun(submission, submission.address, null, truth.commands, truth.range);
  return {
    scope: `${sourceWords(submission.source)} · run ${submission.run}`, source,
    window: { ...submission.summary.window, leap: packedLeap(submission.summary.window) },
    note: source === null ? { level: "warning", message: "Saved run has no matching confirmed sent range and applied commands." } : null,
  };
}

function useFrame(session: PreviewSession, input: PreviewInput) {
  const current = useRef(input);
  useSyncExternalStore(session.subscribe, session.version, session.version);
  useLayoutEffect(() => { current.current = input; });
  useLayoutEffect(() => session.connect(() => current.current), [session]);
  useLayoutEffect(() => { session.refresh(); });
  return { session, frame: session.resolve(input) };
}

export function scenarioPreviewSession(doc: ScenarioDoc): PreviewSession {
  let session = scenarioSessions.get(doc);
  if (session === undefined) {
    session = new PreviewSession({ kind: "scenario", id: doc.id }, () => scenarioInput(doc, Date.now(), scenarioSource(doc)));
    scenarioSessions.set(doc, session);
  }
  return session;
}

export function useScenarioPreviewSession(doc: ScenarioDoc) {
  const subscribe = useCallback((listener: () => void) => doc.subscribe(listener), [doc]);
  const getVersion = useCallback(() => doc.changeVersion, [doc]);
  useSyncExternalStore(subscribe, getVersion, getVersion);
  useStore(hosts, (state) => state.list);
  const now = useNow();
  const source = useMemo(() => scenarioSource(doc), [doc, doc.view?.lastSuccessful, doc.view?.currentResult, doc.editor.rev]);
  return useFrame(scenarioPreviewSession(doc), scenarioInput(doc, now, source));
}

export function useTrajectoryPreviewSession(doc: TrajectoryDoc, track: Track | null) {
  const session = useMemo(() => new PreviewSession({ kind: "trajectory", id: doc.id }), [doc]);
  return useFrame(session, { scope: `Trajectory ${doc.id}`, track, ...(track === null ? {} : { durationMs: Math.round(track.duration * 1000) }) });
}

export function useHostPreviewSession(host: Host) {
  useStore(hosts, (state) => state.list);
  const now = useNow();
  const view = hostView(host, now);
  const session = useMemo(() => new PreviewSession({ kind: "host", key: host.key }), [host.key, host.record.id]);
  const source = useMemo(() => view.submission === null || view.status === null ? null : sourceOfRun(view.submission, host.key, host.record.id, obsCommands(view.status)), [view.submission, view.status, host.key, host.record.id]);
  const track = useBuildTrack(session.pinnedRun()?.buildId ?? view.submission?.source.buildId ?? null);
  return useFrame(session, hostInput(host, now, source, track));
}

export function useSubmissionPreviewSession(submission: SubmissionRecord, truth: RunTruth | null) {
  const session = useMemo(() => new PreviewSession({ kind: "submission", key: submission.key }, undefined, truth?.range.first ?? 0), [submission.key]);
  const input = useMemo(() => submissionInput(submission, truth), [submission, truth]);
  return useFrame(session, input);
}
