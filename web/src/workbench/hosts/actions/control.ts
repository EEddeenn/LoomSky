import { offset, randomId, typed } from "@/core";
import { log, reportProblem, resolveProblem } from "@/workbench/feedback";
import { postCommand, refusal, submit } from "@/io/hosts";
import { isCommandReceipt, isLive, sameCommand, sameRun, type CommandLine, type CommandRecord, type RunId, type SubmissionPayload } from "@/model/host";
import { hostsDb } from "@/io/storage";
import { discardPrepared, hostAccess, prepare, recover, requestStop, service, submissionReply } from "../lifecycle";
import { canStop, changed, currentWindow, hostOf, nameOf, readyForTransmission, stopTargets, type Host } from "../state";
import { saveCredentials } from "../connection";
import { pollNow } from "../runtime";
import { commandWords, hostView, sourceWords } from "../display";

const commandAttempts = new Map<string, object>();

export function airsUntil(h: Host, now: number): { run: number; endGps: number } | null {
  const w = currentWindow(h);
  return canStop(h, now) && w !== null && h.snapshot !== null ? { run: h.snapshot.run, endGps: w.startGpsMs + w.durationMs } : null;
}

export function retry(key: string): Promise<void> | void {
  const h = hostOf(key);
  if (h === undefined) return;
  log(nameOf(h), `Retry · ${h.record.address}`, "action");
  h.source = null;
  for (const intent of h.stops) intent.nextAt = 0;
  for (const p of h.pendings.values()) p.nextAt = 0;
  service(h, Date.now());
  const recovery = h.recovery === "failed" ? recover() : undefined;
  pollNow(key);
  return recovery;
}

export function acknowledge(key: string): void {
  const h = hostOf(key);
  if (h === undefined) return;
  if (h.alarm !== null) {
    h.acked.add(h.alarm.key);
    log(nameOf(h), `Acknowledge · ${h.alarm.kind}`, "action");
    h.alarm = null;
  }
  const refusal = hostView(h, Date.now()).refusal;
  if (refusal !== null) h.acked.add(refusal.key);
  changed();
}

export function stopHost(key: string): void {
  const h = hostOf(key);
  if (h !== undefined && canStop(h, Date.now())) requestStop(h);
}

export function stopAll(): void {
  const targets = stopTargets(Date.now());
  if (targets.length === 0) return;
  log("", `Stop all: ${targets.map(nameOf).join(", ")}`, "action");
  for (const h of targets) stopHost(h.key);
}

export function sendCommand(key: string, value: CommandLine): Promise<void> | void {
  const h = hostOf(key);
  if (h === undefined || h.snapshot?.status == null || h.snapshot.status.state === "ended") return;
  const command = structuredClone(value);
  const target: RunId = { boot: h.snapshot.boot, sequence: h.snapshot.run };
  const actionId = randomId();
  const registration = { ...h.record };
  const id = `host:${key}:command-send:${actionId}`;
  const known = (): CommandRecord | undefined => h.snapshot?.boot === target.boot && h.snapshot.run === target.sequence
    ? h.snapshot.status?.commands.find((record) => record.actionId === actionId && sameCommand(record.command, command)) : undefined;
  const receipt = (record: CommandRecord) => {
    if (record.applied === null || "epoch" in record.applied) { resolveProblem(id); return; }
    const message = "rejected" in record.applied ? `Rejected: ${record.applied.rejected}` : `Discarded: ${record.applied.discarded}`;
    reportProblem({ id, level: "warning", scope: nameOf(h), title: "Command not applied", location: `Run ${target.sequence}`, message: `${commandWords(command)} · ${message}` });
  };
  const send = async (): Promise<void> => {
    const access = hostAccess(h);
    if (access === null) return;
    const existing = known();
    if (existing !== undefined) { receipt(existing); return; }
    if (h.record.id !== registration.id || h.record.token !== registration.token || h.snapshot?.boot !== target.boot
      || h.snapshot.run !== target.sequence || h.snapshot.status === null || h.snapshot.status.state === "ended") {
      reportProblem({ id, level: "warning", scope: nameOf(h), title: "Command not sent", location: `Run ${target.sequence}`, message: "Run or transmitter registration changed. Review the current run before sending." });
      return;
    }
    if (h.link !== "ok" || h.lastOkAt === null || Date.now() - h.lastOkAt >= 3000) {
      reportProblem({ id, level: "warning", scope: nameOf(h), title: "Command not sent", location: `Run ${target.sequence}`, message: "Host status is stale. Reconnect before retrying.", actions: [{ id: "retry-command", label: "Retry command", run: send }] });
      return;
    }
    const attempt = {};
    commandAttempts.set(id, attempt);
    try {
      const registrations = await hostsDb.all();
      if (!access.current() || commandAttempts.get(id) !== attempt) return;
      const current = registrations.find((record) => record.address === registration.address);
      if (current?.id !== registration.id || current.token !== registration.token) {
        reportProblem({ id, level: "warning", scope: nameOf(h), title: "Command not sent", location: `Run ${target.sequence}`, message: "Transmitter changed in another tab. Review before sending." });
        return;
      }
      if (h.snapshot?.boot !== target.boot || h.snapshot.run !== target.sequence || h.snapshot.status === null
        || !isLive(h.snapshot.status) || h.link !== "ok" || h.lastOkAt === null || Date.now() - h.lastOkAt >= 3000) {
        reportProblem({ id, level: "warning", scope: nameOf(h), title: "Command not sent", location: `Run ${target.sequence}`, message: "Run or connection changed. Review before retrying.", actions: [{ id: "retry-command", label: "Retry command", run: send }] });
        return;
      }
      log(nameOf(h), `Send · ${commandWords(command)}`, "action");
      const reply = await postCommand(registration.address, registration.token, target, actionId, command, access.signal);
      if (!access.current() || commandAttempts.get(id) !== attempt) return;
      let body: unknown;
      try { body = JSON.parse(reply.body); } catch { body = null; }
      if (reply.code === 202 && isCommandReceipt(body) && sameRun(body.target, target) && body.actionId === actionId && sameCommand(body.command, command)) {
        receipt(body);
        pollNow(key);
        return;
      }
      const observed = known();
      if (observed !== undefined) { receipt(observed); return; }
      const unknown = reply.code <= 0 || reply.code === 202;
      const message = unknown ? "Acceptance unconfirmed. Retry reuses this command ID." : refusal(reply);
      log(nameOf(h), `${unknown ? "Command acceptance unconfirmed" : "Command refused"}${unknown ? "" : `: ${message}`}`, unknown ? "unknown" : "warn");
      reportProblem({ id, level: "warning", scope: nameOf(h), title: unknown ? "Command acceptance unconfirmed" : "Command not accepted", location: `Run ${target.sequence}`, message: `${commandWords(command)} · ${message}`, actions: [{ id: "retry-command", label: "Retry command", run: send }] });
    } catch (error) {
      if (!access.current() || commandAttempts.get(id) !== attempt) return;
      reportProblem({ id, level: "warning", scope: nameOf(h), title: "Command not sent", location: `Run ${target.sequence}`, message: error instanceof Error ? error.message : String(error), actions: [{ id: "retry-command", label: "Retry command", run: send }] });
    } finally {
      if (commandAttempts.get(id) === attempt) commandAttempts.delete(id);
    }
  };
  return send();
}

export type TransmissionConfig = { gainDb: number; replayMs: number | null };
export function transmissionSnapshot(h: Host): string {
  const snapshot = h.snapshot;
  return JSON.stringify(snapshot === null ? null : {
    boot: snapshot.boot, run: snapshot.run, operation: snapshot.operation,
    device: snapshot.device, station: snapshot.station, state: snapshot.status?.state ?? null,
  });
}

export async function transmit(h: Host, payload: Omit<SubmissionPayload, "at">, config: TransmissionConfig, validate: () => void): Promise<void> {
  const access = hostAccess(h);
  if (access === null || !readyForTransmission(h, Date.now())) throw new Error("Transmitter no longer ready. Review settings.");
  validate();
  const registration = { ...h.record };
  const expectedSnapshot = transmissionSnapshot(h);
  const registrations = await hostsDb.all();
  const canonical = registrations.find((record) => record.address === registration.address);
  if (!access.current() || canonical?.id !== registration.id || canonical.token !== registration.token || canonical.gain !== registration.gain
    || h.record.gain !== registration.gain || transmissionSnapshot(h) !== expectedSnapshot || !readyForTransmission(h, Date.now())) {
    throw new Error("Transmitter registration or status changed. Review settings.");
  }
  validate();
  const operation = { boot: h.snapshot.boot, sequence: (h.snapshot.operation?.id.sequence ?? 0) + 1, nonce: randomId() };
  const gain = String(config.gainDb);
  const record = {
    ...structuredClone(payload),
    key: `${registration.address} ${operation.boot} ${operation.sequence} ${operation.nonce}`,
    address: registration.address, operation, target: null, cancelAt: null, at: Date.now(),
  };
  const cancel = new AbortController();
  const signal = AbortSignal.any([cancel.signal, access.signal]);
  const upload = { share: 0, source: record.source, cancel };
  h.upload = upload;
  h.alarm = null;
  changed();
  const p = await prepare(h, record);
  if (p === null) {
    if (access.current()) { if (h.upload === upload) h.upload = null; changed(); }
    access.signal.throwIfAborted();
    throw new Error("Could not save recovery data. Nothing was transmitted.");
  }
  let dispatched = false;
  try {
    if (!await saveCredentials(h, { gain }, access.signal)) throw new Error("Could not save transmitter settings. Nothing was transmitted.");
    const registrations = await hostsDb.all();
    const canonical = registrations.find((record) => record.address === registration.address);
    if (
      !access.current() || canonical?.id !== registration.id || canonical.token !== registration.token || canonical.gain !== gain ||
      h.record.id !== registration.id || h.record.address !== registration.address || h.record.token !== registration.token || h.record.gain !== gain ||
      transmissionSnapshot(h) !== expectedSnapshot || h.link !== "ok" || h.lastOkAt === null || Date.now() - h.lastOkAt >= 3000 || h.recovery !== "ready" ||
      h.alarm !== null || p.phase !== "active" || p.record.cancelAt !== null || h.pending !== p || h.upload !== upload || signal.aborted
    ) throw new Error("Transmitter changed during preparation. Review settings.");
    validate();
    log(nameOf(h), `Transmit · ${sourceWords(record.source)} · ${config.replayMs === null ? "Live" : `Replay from ${offset(config.replayMs)}`} · gain ${typed(config.gainDb)} dB`, "action");
    p.replyPending = true;
    dispatched = true;
    const reply = await submit(
      registration.address, registration.token, record.bundle,
      { operation, config: { gain_db: config.gainDb, ...(config.replayMs === null ? {} : { replay_ms: config.replayMs }), label: record.label } },
      (share) => {
        if (access.current() && h.upload === upload) { upload.share = share; changed(); }
      },
      signal,
    ).catch((error: unknown) => {
      dispatched = false;
      throw new Error(`Upload could not start: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    });
    if (!access.current()) throw new Error("Transmitter changed during upload. Acceptance unconfirmed.");
    submissionReply(h, p, reply);
    pollNow(h.key);
  } finally {
    p.replyPending = false;
    if (!dispatched) discardPrepared(h, p);
    if (access.current()) {
      if (h.upload === upload) h.upload = null;
      service(h, Date.now());
      changed();
    }
  }
}
