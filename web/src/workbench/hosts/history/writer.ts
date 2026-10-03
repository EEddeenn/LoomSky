import { reportProblem, resolveProblem } from "@/workbench/feedback";
import { patchSubmissionTruth } from "@/io/storage";
import { extendsSubmissionTruth, snapshotTruth, type Snapshot, type SubmissionIdentity, type SubmissionRecord, type SubmissionTruth, type SubmissionTruthPatchResult } from "@/model/host";
import { nameOf, type Host } from "../state";

const progressIntervalMs = 1000;
const retryIntervalMs = 3000;
const closeTimeoutMs = 1000;
const retainedWatermarks = 128;
let ownerSequence = 0;

type Identity = SubmissionIdentity & { key: string };
type Saved = { truth: SubmissionTruth; at: number };
type Attempt = { signature: string; promise: Promise<SubmissionTruthPatchResult | null> };
type Write = {
  identity: Identity;
  truth: SubmissionTruth;
  signature: string;
  name: string;
  nextAt: number;
  attempt: Attempt | null;
  urgent: boolean;
  blocked: boolean;
  missingSince: number | null;
  problem: string | null;
};

type RunHistoryOwner = {
  remember(h: Host, snapshot: Snapshot, now?: number, urgent?: boolean): void;
  flushDue(now: number): void;
  changed(key: string | null): void;
  close(): Promise<void>;
};

function capture(record: SubmissionRecord): Identity {
  return {
    key: record.key, address: record.address, boot: record.boot, run: record.run, digest: record.digest,
    source: structuredClone(record.source),
  };
}

function identityKey(identity: Identity): string {
  const source = identity.source;
  return JSON.stringify([identity.key, identity.address, identity.boot, identity.run, identity.digest,
    source.scenarioId, source.versionId, source.versionNumber, source.buildId, source.engineIdentity]);
}

export function startRunHistory(signal: AbortSignal): RunHistoryOwner {
  const owner = ++ownerSequence;
  const saved = new Map<string, Saved>();
  const writes = new Map<string, Write>();
  const problems = new Set<string>();
  let closing = false;
  let closePromise: Promise<void> | null = null;
  const problemId = (write: Write): string => `host:${write.identity.address}:history:${write.identity.key}:${owner}`;

  const clearProblem = (write: Write): void => {
    if (write.problem === null) return;
    const id = problemId(write);
    problems.delete(id);
    write.problem = null;
    resolveProblem(id);
  };

  const warn = (write: Write, message: string, title = "Could not save run history"): void => {
    if (closing || write.problem === message) return;
    write.problem = message;
    const id = problemId(write);
    problems.add(id);
    reportProblem({
      id, level: "warning", scope: write.name, title, location: "Run history", message,
      actions: [{ id: "retry", label: "Retry", run: async () => { await flush(write); } }],
    });
  };

  const schedule = (write: Write, delay: number): void => {
    if (closing || write.blocked || write.attempt !== null) return;
    write.nextAt = Date.now() + delay;
  };

  const flush = (write: Write, final = false): Promise<SubmissionTruthPatchResult | null> => {
    const key = identityKey(write.identity);
    if (closing && !final || writes.get(key) !== write) return Promise.resolve(null);
    if (write.attempt !== null) return write.attempt.promise;
    write.nextAt = Number.POSITIVE_INFINITY;
    write.urgent = false;
    write.blocked = false;
    const { truth, signature } = write;
    let attempt: Attempt;
    const promise = Promise.resolve().then(async (): Promise<SubmissionTruthPatchResult | null> => {
      let result: SubmissionTruthPatchResult | null = null;
      let failure: unknown;
      try {
        result = await patchSubmissionTruth(write.identity.key, write.identity, truth);
      } catch (error) {
        failure = error;
      } finally {
        if (write.attempt === attempt) write.attempt = null;
      }
      if (closing || writes.get(key) !== write) return result;
      if (result !== null && "truth" in result) {
        saved.delete(key);
        saved.set(key, { truth: result.truth, at: Date.now() });
        while (saved.size > retainedWatermarks) saved.delete(saved.keys().next().value!);
        write.missingSince = null;
        clearProblem(write);
        if (extendsSubmissionTruth(result.truth, write.truth)) writes.delete(key);
        else schedule(write, write.urgent ? 0 : progressIntervalMs);
      } else if (result?.kind === "sourceConflict") {
        write.blocked = true;
        warn(write, "Saved run ID or commands conflict with this observation. Review before retrying.");
      } else if (result?.kind === "missing") {
        write.missingSince ??= Date.now();
        if (Date.now() - write.missingSince >= retryIntervalMs) {
          warn(write, "Run snapshot is not saved yet. Retrying.", "Waiting for run snapshot");
        }
        schedule(write, write.urgent ? 0 : progressIntervalMs);
      } else {
        const message = failure instanceof Error ? failure.message : String(failure);
        warn(write, `${message} · Retrying.`);
        schedule(write, write.urgent ? 0 : retryIntervalMs);
      }
      return result;
    });
    attempt = { signature, promise };
    write.attempt = attempt;
    return promise;
  };

  const remember = (h: Host, snapshot: Snapshot, now = Date.now(), urgent = false): void => {
    if (closing) return;
    const record = h.source?.record ?? null;
    const truth = snapshotTruth(h.record.address, snapshot, record);
    if (record === null || truth === null) return;
    const before = record.truth;
    if (before !== undefined && !extendsSubmissionTruth(truth, before)) return;
    record.truth = truth;
    const identity = capture(record);
    const key = identityKey(identity);
    const previous = saved.get(key);
    if (previous !== undefined && extendsSubmissionTruth(previous.truth, truth)) return;
    let write = writes.get(key);
    if (write !== undefined && !extendsSubmissionTruth(truth, write.truth)) return;
    const immediately = urgent || snapshot.status?.state === "ended" || before === undefined || truth.commands.length !== before.commands.length;
    const captured = structuredClone(truth);
    const signature = JSON.stringify(captured);
    if (write !== undefined && write.signature === signature && !urgent) return;
    if (write === undefined) {
      write = {
        identity, truth: captured, signature, name: nameOf(h), nextAt: Number.POSITIVE_INFINITY,
        attempt: null, urgent: immediately, blocked: false, missingSince: null, problem: null,
      };
      writes.set(key, write);
    } else {
      write.truth = captured;
      write.signature = signature;
      write.urgent ||= immediately;
    }
    if (!Number.isFinite(write.nextAt) || write.urgent) schedule(write, write.urgent ? 0 : Math.max(0, progressIntervalMs - (now - (previous?.at ?? 0))));
    if (write.urgent) void flush(write);
  };

  const changed = (key: string | null): void => {
    if (closing) return;
    for (const write of writes.values()) {
      if (write.missingSince !== null && (key === null || key === write.identity.key)) {
        write.urgent = true;
        schedule(write, 0);
      }
    }
  };

  const close = (): Promise<void> => {
    if (closePromise !== null) return closePromise;
    let complete = (): void => {};
    closePromise = new Promise<void>((resolve) => { complete = resolve; });
    closing = true;
    signal.removeEventListener("abort", abort);
    for (const id of problems) resolveProblem(id);
    problems.clear();
    saved.clear();
    const pending = [...writes.values()];
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      writes.clear();
      complete();
    };
    const timer = setTimeout(finish, closeTimeoutMs);
    void Promise.all(pending.map(async (write) => {
      const attempt = write.attempt;
      if (attempt !== null) {
        const result = await attempt.promise;
        if (finished || attempt.signature === write.signature || result !== null && "truth" in result && extendsSubmissionTruth(result.truth, write.truth)) return;
      }
      if (!finished && !write.blocked) await flush(write, true);
    })).then(finish, finish);
    return closePromise;
  };

  const abort = (): void => { void close(); };
  if (signal.aborted) void close();
  else signal.addEventListener("abort", abort, { once: true });
  return {
    remember, changed, close,
    flushDue(now) { if (!closing) for (const write of writes.values()) if (!write.blocked && now >= write.nextAt) void flush(write); },
  };
}
