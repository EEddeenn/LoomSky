import { isRecord, randomId } from "@/core";
import { announce, log, reportProblem, resolveProblem } from "@/workbench/feedback";
import { deletePending, deleteStop, loadPending, loadStops, patchSubmissionTruth, savePending, saveStop, saveSubmission } from "@/io/storage";
import {
  isLive, isOperationId, isRunId, sameOperation, sameRun, sameSubmissionSource,
  type OperationId, type PendingSubmissionRecord, type RunId, type Snapshot, type StopIntentRecord, type SubmissionRecord,
} from "@/model/host";
import { cancelOperation, stopRun, type Reply } from "@/io/hosts";
import { changed, hostOf, hosts, nameOf, type Host, type Pending, type Stop } from "./state";

const retryMs = 3000;
const recoveryFailures = new Map<Host, Map<string, string>>();
type Remember = (h: Host, snapshot: Snapshot, now?: number, urgent?: boolean) => void;
type Runtime = { signal: AbortSignal; remember: Remember; recovery: Promise<void> | null; recoverAgain: boolean };
let runtime: Runtime | null = null;

export function activateHostLifecycle(signal: AbortSignal, remember: Remember): void {
  const current: Runtime = { signal, remember, recovery: null, recoverAgain: false };
  runtime = current;
  for (const h of recoveryFailures.keys()) resolveProblem(recoveryProblemId(h));
  recoveryFailures.clear();
  signal.addEventListener("abort", () => {
    if (runtime !== current) return;
    runtime = null;
    for (const h of recoveryFailures.keys()) resolveProblem(recoveryProblemId(h));
    recoveryFailures.clear();
  }, { once: true });
}

export function hostAccess(h: Host): { signal: AbortSignal; current(): boolean } | null {
  const owner = runtime;
  if (owner === null || owner.signal.aborted || hostOf(h.key) !== h) return null;
  const { id, address, token } = h.record;
  return { signal: owner.signal, current: () => runtime === owner && !owner.signal.aborted && hostOf(h.key) === h
    && h.record.id === id && h.record.address === address && h.record.token === token };
}

function recoveryProblemId(h: Host): string { return `host:${h.key}:recovery:${h.record.id}`; }

function reportRecovery(h: Host, failures: Map<string, string>): void {
  const recovering = [...failures.keys()].some((key) => key !== "prepare");
  reportProblem({
    id: recoveryProblemId(h), level: "error", scope: nameOf(h),
    title: recovering ? "Could not save run recovery" : "Could not prepare submission",
    location: recovering ? "Run recovery" : "Preparation",
    message: `${recovering ? "Keep this page open." : "Nothing was transmitted."} ${[...new Set(failures.values())].join(" · ")}`,
  });
}

function storageFailure(h: Host, operation: string, error: unknown): void {
  if (hostAccess(h) === null) return;
  const message = error instanceof Error ? error.message : String(error);
  const failures = recoveryFailures.get(h) ?? new Map<string, string>();
  if (failures.get(operation) === message) return;
  failures.set(operation, message);
  recoveryFailures.set(h, failures);
  reportRecovery(h, failures);
}

function storageSucceeded(h: Host, operation: string): void {
  const failures = recoveryFailures.get(h);
  if (hostAccess(h) === null || failures === undefined || !failures.delete(operation)) return;
  if (failures.size === 0) {
    recoveryFailures.delete(h);
    resolveProblem(recoveryProblemId(h));
  } else reportRecovery(h, failures);
}

function pending(record: PendingSubmissionRecord): Pending {
  return { record, writes: Promise.resolve(), busy: false, nextAt: 0, phase: "active", replyPending: false, acceptedSaved: false, accepting: null };
}

function write(p: Pending, action: () => Promise<void>): Promise<void> {
  const work = p.writes.then(action);
  p.writes = work.catch(() => undefined);
  return work;
}

function save(h: Host, p: Pending): Promise<void> {
  const access = hostAccess(h);
  const record = structuredClone(p.record);
  return write(p, () => savePending(record)).then(() => { if (access?.current()) storageSucceeded(h, `pending:${record.key}`); });
}

export function recover(): Promise<void> {
  const owner = runtime;
  if (owner === null || owner.signal.aborted) return Promise.resolve();
  if (owner.recovery !== null) { owner.recoverAgain = true; return owner.recovery; }
  owner.recovery = (async () => {
    do { owner.recoverAgain = false; await restoreRecovery(); }
    while (owner.recoverAgain && runtime === owner && !owner.signal.aborted);
  })().finally(() => { owner.recovery = null; });
  return owner.recovery;
}

async function restoreRecovery(): Promise<void> {
  const loading = hosts.get().list.map((h) => ({ h, access: hostAccess(h), pending: new Map(h.pendings), stops: [...h.stops],
    busy: new Set([...h.pendings.values(), ...h.stops].filter((item) => item.busy)),
  }));
  try {
    const [records, stops] = await Promise.all([loadPending(), loadStops()]);
    for (const before of loading) {
      const { h, access } = before;
      if (!access?.current()) continue;
      const durable = new Set(records.filter((record) => record.address === h.record.address).map((record) => record.key));
      for (const record of records) {
        if (record.address !== h.record.address) continue;
        const existing = h.pendings.get(record.key);
        if (existing !== undefined) {
          existing.record.cancelAt ??= record.cancelAt;
          existing.record.target ??= record.target;
        } else if (!before.pending.has(record.key)) h.pendings.set(record.key, pending(record));
      }
      for (const [key, item] of h.pendings) {
        if (!durable.has(key) && before.pending.get(key) === item && item.phase === "active" && !item.busy
          && !before.busy.has(item) && !item.replyPending && item.accepting === null && !(h.upload !== null && h.pending === item)) h.pendings.delete(key);
      }
      for (const record of stops) {
        if (record.address === h.record.address && !h.stops.some((item) => item.key === record.key)
          && !before.stops.some((item) => item.key === record.key)) h.stops.push(restoredStop(record));
      }
      h.stops = h.stops.filter((item) => item.retiring || item.busy || before.busy.has(item) || !item.persisted
        || !before.stops.includes(item) || stops.some((record) => record.key === item.key));
      h.recovery = "ready";
      if (h.snapshot !== null && h.link === "ok" && h.lastOkAt !== null && Date.now() - h.lastOkAt < 3000) reconcile(h, h.snapshot);
      service(h, Date.now());
    }
  } catch (error) {
    for (const { h, access } of loading) {
      if (!access?.current() || h.recovery === "ready") continue;
      h.recovery = "failed";
      log(nameOf(h), `Run recovery failed: ${error instanceof Error ? error.message : String(error)}`, "warn");
    }
  }
  if (loading.some(({ access }) => access?.current())) changed();
}

export async function prepare(h: Host, record: PendingSubmissionRecord): Promise<Pending | null> {
  const access = hostAccess(h);
  if (access === null) return null;
  const p = pending(record);
  p.busy = true;
  h.pendings.set(record.key, p);
  changed();
  try {
    await save(h, p);
    if (!access.current()) {
      p.phase = "retiring";
      await write(p, () => deletePending(p.record.key));
      return null;
    }
    storageSucceeded(h, "prepare");
    return p.phase === "active" ? p : null;
  } catch (error) {
    if (!access.current()) return null;
    const abandoned = p.record.cancelAt === null;
    if (abandoned) { p.phase = "retiring"; h.pendings.delete(record.key); }
    storageFailure(h, abandoned ? "prepare" : `pending:${record.key}`, error);
    changed();
    return null;
  } finally { p.busy = false; }
}

function submission(p: Pending, target: RunId): SubmissionRecord {
  const { address, source, digest, label, texts, bundle, summary, at } = p.record;
  return { key: `${address} ${target.boot} ${target.sequence}`, address, boot: target.boot, run: target.sequence, source, digest, label, texts, bundle, summary, at };
}

function accepted(h: Host, p: Pending, target: RunId): Promise<void> {
  const access = hostAccess(h);
  if (access === null || h.pendings.get(p.record.key) !== p || p.record.target !== null && !sameRun(p.record.target, target)) return Promise.resolve();
  p.record.target = target;
  const proposed = submission(p, target);
  const current = h.source?.record;
  const record = current?.key === proposed.key && current.digest === proposed.digest && sameSubmissionSource(current.source, proposed.source)
    && current.address === proposed.address && current.boot === proposed.boot && current.run === proposed.run ? current : proposed;
  if (h.snapshot?.boot === target.boot && h.snapshot.run === target.sequence) {
    h.source = { key: record.key, record, error: null };
    runtime?.remember(h, h.snapshot);
  }
  if (p.acceptedSaved) return Promise.resolve();
  if (p.accepting !== null) return p.accepting;
  p.accepting = (async () => {
    await save(h, p);
    await write(p, () => saveSubmission(record));
    await write(p, async () => {
      if (record.truth === undefined) return;
      const result = await patchSubmissionTruth(record.key, record, record.truth);
      if (!("truth" in result)) throw new Error(result.kind === "missing" ? "Submitted run snapshot missing" : "Submitted run conflicts with observed output");
      if (access.current()) record.truth = result.truth;
    });
    if (!access.current()) return;
    p.acceptedSaved = true;
    storageSucceeded(h, `accepted:${p.record.key}`);
    if (h.snapshot !== null) runtime?.remember(h, h.snapshot, Date.now(), true);
  })().finally(() => { p.accepting = null; });
  return p.accepting;
}

function finish(h: Host, p: Pending, message: string): void {
  if (p.phase === "retiring" || h.pendings.get(p.record.key) !== p) return;
  const current = h.pending === p;
  p.phase = "retiring";
  if (current) { h.upload?.cancel.abort(); h.upload = null; }
  log(nameOf(h), message, "notice");
  service(h, Date.now());
  changed();
}

export function discardPrepared(h: Host, p: Pending): void {
  if (hostAccess(h) !== null && h.pendings.get(p.record.key) === p) { finish(h, p, "Submission not sent"); return; }
  p.phase = "retiring";
  if (!p.replyPending) void write(p, () => deletePending(p.record.key)).catch(() => undefined);
}

export function reconcile(h: Host, snap: Snapshot): void {
  const access = hostAccess(h);
  if (access === null) return;
  for (const p of h.pendings.values()) {
    if (p.phase === "retiring") continue;
    const id = p.record.operation;
    const op = snap.operation;
    if (snap.boot !== id.boot) finish(h, p, "Submission ended: host restarted");
    else if (op !== null && op.id.sequence >= id.sequence) {
      if (!sameOperation(op.id, id)) finish(h, p, "Submission no longer active on host");
      else if (op.state === "cancelled" || op.state === "rejected") {
        finish(h, p, op.state === "cancelled" ? "Cancellation confirmed · nothing was transmitted" : "Upload rejected · nothing was transmitted");
      } else if (op.target !== null) {
        const saved = accepted(h, p, op.target);
        if (snap.boot === op.target.boot && snap.run === op.target.sequence && snap.status?.state === "ended") finish(h, p, "Run ended");
        void saved.then(() => { if (access.current()) changed(); }).catch((error) => { if (access.current()) storageFailure(h, `accepted:${p.record.key}`, error); });
      }
    }
  }
  for (const stop of h.stops) {
    const target = stop.target;
    if (stop.retiring || target === null) continue;
    if (target.kind === "run" ? target.id.boot !== snap.boot || snap.run > target.id.sequence || snap.run === target.id.sequence && !isLive(snap.status)
      : operationEnded(target.id, snap)) stop.retiring = true;
  }
  service(h, Date.now());
}

export function submissionReply(h: Host, p: Pending, reply: Reply): void {
  const access = hostAccess(h);
  if (access === null || h.pendings.get(p.record.key) !== p) return;
  let body: unknown;
  try { body = JSON.parse(reply.body); } catch { body = null; }
  if (reply.code === 202 && isRecord(body) && isOperationId(body.operation) && sameOperation(body.operation, p.record.operation)
    && isRunId(body.target) && body.target.boot === p.record.operation.boot) {
    void accepted(h, p, body.target).then(() => {
      if (!access.current()) return;
      if (h.snapshot !== null) reconcile(h, h.snapshot);
      changed();
    }).catch((error) => { if (access.current()) storageFailure(h, `accepted:${p.record.key}`, error); });
  } else if (p.phase === "active") {
    log(nameOf(h), `Acceptance unconfirmed${reply.code > 0 ? ` (HTTP ${reply.code})` : ""} · checking host`, "unknown");
    if (reply.code >= 400 && reply.code < 500) { p.record.cancelAt ??= Date.now(); service(h, Date.now()); }
  }
}

function restoredStop(record: StopIntentRecord): Stop {
  return { ...record, queued: true, busy: false, nextAt: 0, saving: Promise.resolve(), persisted: true, retiring: false };
}

export function persistRecovery(): void {
  for (const h of recoveryFailures.keys()) {
    if (hostOf(h.key) === h) continue;
    recoveryFailures.delete(h);
    resolveProblem(recoveryProblemId(h));
  }
}

export function requestStop(h: Host): void {
  if (hostAccess(h) === null) return;
  const now = Date.now();
  const p = h.pending;
  if (p !== null) {
    p.record.cancelAt ??= now;
    p.nextAt = 0;
    h.upload?.cancel.abort();
    log(nameOf(h), "Stop requested for this submission · unconfirmed", "action");
  } else {
    const snap = h.snapshot;
    const seen = h.record.seen;
    let target: Stop["target"] = null;
    if (snap?.operation?.state === "uploading") target = { kind: "operation", id: { ...snap.operation.id } };
    else if (snap !== null && isLive(snap.status)) target = { kind: "run", id: { boot: snap.boot, sequence: snap.run } };
    else if (snap === null && seen?.live) target = { kind: "run", id: { boot: seen.boot, sequence: seen.run } };
    const suffix = target === null ? `pending ${randomId()}` : target.kind === "operation"
      ? `operation ${target.id.boot} ${target.id.sequence} ${target.id.nonce}` : `run ${target.id.boot} ${target.id.sequence}`;
    let key = `${h.record.address} ${suffix}`;
    const existing = h.stops.find((item) => item.key === key);
    if (existing === undefined || existing.retiring) {
      if (existing !== undefined) key += ` ${randomId()}`;
      const stop = restoredStop({ key, address: h.record.address, at: now, target });
      stop.persisted = false;
      h.stops.push(stop);
    } else existing.nextAt = 0;
    log(nameOf(h), "Stop requested · unconfirmed", "action");
  }
  announce(`Stop requested for ${nameOf(h)}`);
  service(h, now);
  changed();
}

function resolveStops(h: Host): void {
  if (h.recovery !== "ready") return;
  for (const stop of h.stops) {
    if (stop.retiring || stop.target !== null) continue;
    const candidates = [...h.pendings.values()].filter((p) => p.phase === "active" && p.record.at <= stop.at);
    for (const p of candidates) p.record.cancelAt ??= stop.at;
    if (candidates.length === 0) stop.retiring = true;
  }
}

function operationEnded(id: OperationId, snap: Snapshot): boolean {
  if (id.boot !== snap.boot) return true;
  const op = snap.operation;
  if (op === null || op.id.sequence < id.sequence) return false;
  if (!sameOperation(id, op.id) || op.state === "cancelled" || op.state === "rejected") return true;
  return op.target !== null && snap.boot === op.target.boot && snap.run === op.target.sequence && snap.status?.state === "ended";
}

type Access = NonNullable<ReturnType<typeof hostAccess>>;
async function servicePending(h: Host, p: Pending, access: Access): Promise<void> {
  p.busy = true;
  try {
    if (p.phase === "retiring") {
      if (p.record.target !== null) await accepted(h, p, p.record.target);
      if (!access.current() || p.record.target !== null && !p.acceptedSaved) return;
      await write(p, () => deletePending(p.record.key));
      if (access.current() && h.pendings.get(p.record.key) === p) h.pendings.delete(p.record.key);
    } else {
      try { await save(h, p); }
      catch (error) { if (access.current()) storageFailure(h, `pending:${p.record.key}`, error); }
      if (access.current() && h.pendings.get(p.record.key) === p && p.phase === "active") {
        await cancelOperation(h.record.address, h.record.token, p.record.operation, access.signal);
      }
    }
    if (access.current() && p.phase === "retiring") storageSucceeded(h, `pending:${p.record.key}`);
  } catch (error) {
    if (access.current()) storageFailure(h, `pending:${p.record.key}`, error);
  } finally {
    p.busy = false;
    p.nextAt = Date.now() + retryMs;
  }
}

async function serviceStop(h: Host, intent: Stop, access: Access): Promise<void> {
  intent.busy = true;
  try {
    if (intent.retiring) {
      await intent.saving.catch(() => undefined);
      if (!access.current()) return;
      await deleteStop(intent.key);
      if (access.current()) { h.stops = h.stops.filter((item) => item !== intent); storageSucceeded(h, `stop:${intent.key}`); }
      return;
    }
    if (!intent.persisted) {
      const { key, address, at, target } = intent;
      intent.saving = saveStop({ key, address, at, target }).then(() => {
        intent.persisted = true;
        if (access.current()) storageSucceeded(h, `stop:${key}`);
      });
      try { await intent.saving; }
      catch (error) { if (access.current()) storageFailure(h, `stop:${key}`, error); }
    }
    const target = intent.target;
    if (access.current() && target !== null && !intent.retiring && h.stops.includes(intent)) {
      const reply = target.kind === "run" ? await stopRun(h.record.address, h.record.token, target.id, access.signal)
        : await cancelOperation(h.record.address, h.record.token, target.id, access.signal);
      if (access.current()) intent.queued = reply.code !== 202;
    }
  } catch (error) {
    if (access.current()) storageFailure(h, `stop:${intent.key}`, error);
  } finally {
    intent.busy = false;
    intent.nextAt = Date.now() + retryMs;
    if (access.current()) changed();
  }
}

export function service(h: Host, now: number): void {
  const access = hostAccess(h);
  if (access === null) return;
  resolveStops(h);
  for (const p of h.pendings.values()) {
    if (!p.busy && now >= p.nextAt && (p.phase === "retiring" ? !p.replyPending : p.record.cancelAt !== null)) void servicePending(h, p, access);
  }
  for (const intent of h.stops) {
    if (!intent.busy && now >= intent.nextAt && (intent.retiring || intent.target !== null || !intent.persisted)) void serviceStop(h, intent, access);
  }
}
