import { gpsClock } from "@/model/gnss";
import { group, offset } from "@/core";
import { announce, log, toast } from "@/workbench/feedback";
import { getRunKnowledge, getSubmission, onStorageChanges } from "@/io/storage";
import { startRunHistory } from "./history/writer";
import { activateHostLifecycle, persistRecovery, reconcile, recover, service } from "./lifecycle";
import { activityOf, changed, hostOf, hosts, nameOf, onAirSeen, rfBound, type Host } from "./state";
import { commandWords, radioWord, uncertainty } from "./display";
import { persistObservations, restoreHosts } from "./connection/registration";
import { startStatusPoller, type Poll } from "@/io/hosts";
import { extendsSubmissionTruth, isLive, observationOf, sameSubmissionSource, snapshotWindow, type Snapshot } from "@/model/host";

let requestPoll: ((key: string) => void) | null = null;
type Remember = (h: Host, snapshot: Snapshot, now?: number, urgent?: boolean) => void;

function rate(h: Host, now: number): number {
  return activityOf(h, now) === "off" ? 1 : 5;
}

export function pollNow(key: string): void {
  requestPoll?.(key);
}

function alarm(name: string, text: string, spoken: string): void {
  log(name, text, "alarm");
  announce(`${name} ${spoken}`, true);
}

function checkActivity(h: Host, now: number): boolean {
  const c = activityOf(h, now);
  const before = h.seenActivity;
  h.seenActivity = c;
  if (before === null || before === c) return false;
  if (c === "unknown") {
    const bound = rfBound(h);
    const text = uncertainty(h) ?? `no answer while ${onAirSeen(h) ? "on air" : "armed"}${bound === null ? "" : ` · RF at most until ${gpsClock(bound)} GPS`}`;
    log(nameOf(h), text, "unknown");
    announce(`${nameOf(h)} ${text}`, true);
  }
  return true;
}

async function attach(h: Host, snap: Snapshot, signal: AbortSignal, rememberTruth: Remember): Promise<void> {
  const key = `${h.record.address} ${snap.boot} ${snap.run}`;
  if (h.source?.key === key) return;
  const source = { key, record: null, error: null } as NonNullable<Host["source"]>;
  h.source = source;
  try {
    const record = await getSubmission(key);
    if (signal.aborted || hostOf(h.key) !== h || h.source !== source || h.snapshot?.boot !== snap.boot || h.snapshot.run !== snap.run) return;
    source.record = record ?? null;
    if (h.snapshot !== null) rememberTruth(h, h.snapshot);
  } catch (error) {
    if (signal.aborted || hostOf(h.key) !== h || h.source !== source) return;
    source.error = error instanceof Error ? error.message : String(error);
    log(nameOf(h), `Could not load run snapshot: ${source.error}`, "warn");
  }
  if (!signal.aborted && hostOf(h.key) === h) changed();
}

async function refreshKnowledge(h: Host, signal: AbortSignal): Promise<void> {
  const source = h.source;
  const record = source?.record;
  if (source == null || record == null) return;
  try {
    const knowledge = await getRunKnowledge(record.key);
    if (signal.aborted || hostOf(h.key) !== h || h.source !== source) return;
    if (knowledge === undefined) {
      source.record = null;
      source.error = "Saved run snapshot no longer available";
    } else {
      const expected = knowledge.identity;
      if (expected.address !== record.address || expected.boot !== record.boot || expected.run !== record.run || expected.digest !== record.digest || !sameSubmissionSource(expected.source, record.source)) {
        source.record = null;
        source.error = "Saved run snapshot identity changed";
      } else if (knowledge.truth !== null && (source.record?.truth === undefined || extendsSubmissionTruth(knowledge.truth, source.record.truth))) {
        source.record = { ...record, truth: knowledge.truth };
        source.error = null;
      }
    }
  } catch (error) {
    if (signal.aborted || hostOf(h.key) !== h || h.source !== source || source.record !== record) return;
    source.error = error instanceof Error ? error.message : String(error);
  }
  if (!signal.aborted) changed();
}

function restartedDuringRun(h: Host, snap: Snapshot): void {
  const before = h.snapshot;
  const oldBoot = before?.boot ?? h.record.seen?.boot ?? null;
  const wasLive = before !== null ? isLive(before.status) : (h.record.seen?.live ?? false);
  if (oldBoot === null || oldBoot === snap.boot || !wasLive || h.alarm !== null) return;
  const run = before?.run ?? h.record.seen?.run ?? 0;
  const lastSent = before?.status?.sent ?? null;
  const window = before === null ? null : snapshotWindow(h.record.address, before, (h.source?.record ?? null));
  const startGpsMs = window?.startGpsMs ?? h.record.seen?.startGps ?? null;
  h.alarm = {
    kind: "restarted",
    run,
    reason: "",
    message: "",
    lastGps: lastSent !== null && startGpsMs !== null ? startGpsMs + lastSent : (h.record.seen?.sentGps ?? null),
    key: `${oldBoot}|${run}`,
  };
  const text = `LoomSky restarted · run ${run} ended · ${radioWord({ ...h, snapshot: snap })}`;
  alarm(snap.station.name, text, text);
}

function ended(h: Host, snap: Snapshot, wasLive: boolean): void {
  const s = snap.status;
  if (s === null || s.state !== "ended") return;
  const name = snap.station.name;
  const runKey = `${snap.boot}|${snap.run}`;
  const window = snapshotWindow(h.record.address, snap, (h.source?.record ?? null));
  const what = s.config.label || `run ${snap.run}`;
  if ("refused" in s.outcome) {
    log(name, `Refused ${what}: ${s.outcome.refused.reason} · ${s.outcome.refused.message} · nothing was transmitted`, "warn");
    announce(`${name} refused ${what}`);
  } else if ("failed" in s.outcome) {
    h.alarm = {
      kind: "failed",
      run: snap.run,
      reason: s.outcome.failed.reason,
      message: s.outcome.failed.message,
      lastGps: s.sent !== null && window !== null ? window.startGpsMs + s.sent : null,
      key: runKey,
    };
    alarm(name, `Failed: ${s.outcome.failed.reason} · ${s.outcome.failed.message}`, `failed: ${s.outcome.failed.message}`);
  } else if (wasLive) {
    const words =
      "completed" in s.outcome
        ? `${name} completed ${what}`
        : s.sent !== null && window !== null
          ? `${name} stopped at ${gpsClock(window.startGpsMs + s.sent)} GPS`
          : `${name} stopped before the window · nothing was transmitted`;
    log(name, words.slice(name.length + 1), "notice");
    toast(words);
  }
}

function track(h: Host, snap: Snapshot, now: number, signal: AbortSignal, rememberTruth: Remember): void {
  const before = h.snapshot;
  const name = snap.station.name;
  const s = snap.status;
  if (before !== null && (before.boot !== snap.boot || before.run !== snap.run)) rememberTruth(h, before, now, true);
  restartedDuringRun(h, snap);
  if (s !== null) {
    const window = snapshotWindow(h.record.address, snap, (h.source?.record ?? null));
    const prior = before !== null && before.boot === snap.boot && before.run === snap.run ? before.status : null;
    const wasLive = prior !== null || (before !== null ? isLive(before.status) : (h.record.seen?.live ?? false));
    if (!h.acked.has(`${snap.boot}|${snap.run}`) && prior?.state !== "ended") ended(h, snap, wasLive);
    if (prior !== null && prior.first === null && s.state === "on_air") {
      const from = s.first === null ? "" : ` from ${offset(s.first)}${s.config.replay_ms === null ? "" : " · own clock"}`;
      log(name, `${name} on air: ${s.config.label || `run ${snap.run}`}${from}`, "onair");
      toast(`${name} on air`);
    } else if (prior !== null && prior.first === null && prior.state === "starting" && s.state === "waiting" && window !== null) {
      log(name, `waits for ${gpsClock(window.startGpsMs)} GPS`, "notice");
    }
    if (prior !== null) {
      for (const [i, r] of s.commands.entries()) {
        if (r.applied === null || (prior.commands[i]?.applied ?? null) !== null) continue;
        if ("epoch" in r.applied) log(name, `applied ${commandWords(r.command, true)}`, "notice");
        else if ("rejected" in r.applied) log(name, `Rejected ${commandWords(r.command, true)} · ${r.applied.rejected}`, "warn");
        else log(name, `discarded ${commandWords(r.command, true)} · run ${snap.run} ended (${r.applied.discarded})`, "warn");
      }
    }
    const runId = `${snap.boot}|${snap.run}`;
    if (h.faultRun !== runId) {
      h.faultRun = runId;
      h.faults = [];
    }
    if (prior !== null) {
      for (const kind of ["underflow", "late", "sequence", "short"] as const) {
        const rise = s.counts[kind] - prior.counts[kind];
        if (rise <= 0) continue;
        if (s.sent !== null) h.faults.push({ epoch: s.sent, kind });
        log(name, `${rise} ${kind}${window === null || s.sent === null ? "" : ` at ${gpsClock(window.startGpsMs + s.sent)} GPS · epoch ${group(s.sent)}`}`, "warn");
      }
    }
  }
  if (h.seenActivity === "unknown" && h.link !== "ok") log(name, "answers again", "notice");
  h.snapshot = snap;
  reconcile(h, snap);
  rememberTruth(h, snap, now);
  void attach(h, snap, signal, rememberTruth);
  service(h, now);
}

function remember(h: Host, snap: Snapshot): void {
  h.record = {
    ...h.record,
    name: snap.station.name,
    seen: observationOf(h.record.address, snap, (h.source?.record ?? null), h.lastOkAt ?? Date.now()),
  };
}

export function startHosts(): { setActive(active: boolean): void; close(): Promise<void> } {
  let closed = false;
  let segment: { stop(): Promise<void> } | null = null;
  const drains = new Set<Promise<void>>();

  function activate(): void {
    if (closed || segment !== null) return;
    const cancel = new AbortController();
    const signal = cancel.signal;
    const history = startRunHistory(signal);
    type Watched = { host: Host; registration: string; token: string; poller: ReturnType<typeof startStatusPoller> };
    const watched = new Map<string, Watched>();
    let starting = true;
    let syncing = false;
    let syncAgain = false;
    const rememberTruth: Remember = (h, snapshot, now, urgent) => {
      if (!signal.aborted) history.remember(h, snapshot, now, urgent);
    };
    activateHostLifecycle(signal, rememberTruth);

    function watch(): void {
      if (signal.aborted || starting) return;
      for (const [key, previous] of watched) {
        const h = hostOf(key);
        if (h === previous.host && h.record.id === previous.registration && h.record.token === previous.token) continue;
        previous.poller.close();
        previous.host.upload?.cancel.abort();
        previous.host.upload = null;
        watched.delete(key);
      }
      for (const h of hosts.get().list) {
        if (watched.has(h.key)) continue;
        h.link = "none";
        h.lastOkAt = null;
        if (h.source?.record == null) h.source = null;
        else void refreshKnowledge(h, signal);
        const entry = { host: h, registration: h.record.id, token: h.record.token } as Watched;
        entry.poller = startStatusPoller(h.record.address, entry.token, () => rate(h, Date.now()), (poll) => {
          if (watched.get(h.key) === entry && hostOf(h.key) === h && h.record.id === entry.registration && h.record.token === entry.token) receive(h, poll);
        }, signal);
        watched.set(h.key, entry);
      }
    }

    function receive(h: Host, p: Poll): void {
      if (signal.aborted) return;
      const now = Date.now();
      if (p.kind === "status") {
        track(h, p.snapshot, now, signal, rememberTruth);
        h.link = "ok";
        h.lastOkAt = p.receivedAt;
        const offsetMs = p.snapshot.now_ms - (p.sentAt + p.receivedAt) / 2;
        if (h.offsetMs !== null && Math.abs(offsetMs) > 500 && Math.abs(h.offsetMs) <= 500) {
          log(nameOf(h), `clock ${offsetMs > 0 ? "+" : "−"}${(Math.abs(offsetMs) / 1000).toFixed(2)} s from this computer`, "notice");
        }
        h.offsetMs = offsetMs;
        remember(h, p.snapshot);
      } else h.link = p.kind;
      checkActivity(h, now);
      changed();
    }

    async function synchronize(): Promise<void> {
      if (signal.aborted) return;
      if (syncing) { syncAgain = true; return; }
      syncing = true;
      try {
        do {
          syncAgain = false;
          if (!await restoreHosts(signal) || signal.aborted) return;
          await recover();
        } while (syncAgain && !signal.aborted);
      } finally {
        syncing = false;
        if (!signal.aborted) { starting = false; watch(); }
      }
    }

    const unsubscribe = hosts.subscribe(watch);
    const unsubscribeStorage = onStorageChanges((event) => {
      if (signal.aborted) return;
      if (event === null || event.scope === "hosts" || event.scope === "pending" || event.scope === "stops") void synchronize();
      if (event !== null && event.scope !== "submissions") return;
      const key = event?.key ?? null;
      history.changed(key);
      for (const h of hosts.get().list) {
        if (h.snapshot === null || key !== null && key !== `${h.record.address} ${h.snapshot.boot} ${h.snapshot.run}`) continue;
        if (h.source?.record != null) void refreshKnowledge(h, signal);
        else { h.source = null; void attach(h, h.snapshot, signal, rememberTruth); }
      }
    });
    const wake = (key: string) => {
      if (signal.aborted) return;
      watched.get(key)?.poller.now();
      void synchronize();
    };
    requestPoll = wake;
    let ticks = 0;
    const timer = setInterval(() => {
      if (signal.aborted || starting) return;
      const now = Date.now();
      history.flushDue(now);
      persistRecovery();
      let dirty = false;
      for (const h of hosts.get().list) { service(h, now); dirty = checkActivity(h, now) || dirty; }
      if (dirty) changed();
      if (++ticks % 4 === 0) void persistObservations(signal);
    }, 250);
    segment = {
      stop() {
        cancel.abort();
        unsubscribe();
        unsubscribeStorage();
        clearInterval(timer);
        for (const entry of watched.values()) entry.poller.close();
        watched.clear();
        if (requestPoll === wake) requestPoll = null;
        for (const h of hosts.get().list) { h.upload?.cancel.abort(); h.upload = null; h.link = "none"; h.lastOkAt = null; }
        changed();
        return history.close();
      },
    };
    void synchronize();
  }

  function deactivate(): void {
    const previous = segment;
    if (previous === null) return;
    segment = null;
    const drain = previous.stop();
    drains.add(drain);
    void drain.finally(() => drains.delete(drain));
  }

  activate();
  return {
    setActive(active) { if (active) activate(); else deactivate(); },
    async close() { closed = true; deactivate(); await Promise.allSettled(drains); },
  };
}
