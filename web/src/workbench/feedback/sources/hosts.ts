import { acknowledge, retry, stopHost } from "@/workbench/hosts/actions";
import { commandWords, hosts, hostView, mayAir, nameOf, onAirSeen, radioWord, rfBound, sourceWords, stopUnconfirmed, uncertainty, type Host } from "@/workbench/hosts";
import { retryHosts } from "@/workbench/hosts/connection";
import { gpsClock, utcClock } from "@/model/gnss";
import { scenarioCatalog } from "@/workbench/documents/scenario";
import { navigate } from "@/workbench/navigation";
import type { Problem } from "@/workbench/feedback";
import { openTransmit } from "@/workbench/transmit";

function connectionMessage(h: Host): string {
  if (h.link === "token") return "Update the token in Device settings, then retry.";
  if (h.link === "origin") {
    const origin = typeof location === "undefined" ? "this page's origin" : location.origin;
    return `Allow ${origin} in host origins, restart LoomSky, then retry.`;
  }
  if (h.link === "http") return "Host status is unreadable. Check the host service, then retry.";
  return "No response. Check the address and connection, then retry.";
}

function problemsOf(h: Host, now: number): Problem[] {
  const problems: Problem[] = [];
  const base = `host:${h.key}`;
  const scope = nameOf(h);
  const location = h.record.address;
  const view = hostView(h, now);
  const cls = view.cls;
  const openRun = { id: "open-transmitter", label: "Open transmitter", run: () => navigate({ workspace: "resource", kind: "host", id: h.key, tab: "run" }) };

  if (cls === "unknown" && (h.recovery !== "loading" || h.record.seen?.live === true)) {
    const bound = rfBound(h);
    const queued = h.stop?.queued === true;
    const reason = uncertainty(h) ?? `No answer while ${onAirSeen(h) ? "on air" : "armed"}.`;
    problems.push({
      id: `${base}:unknown`, level: "warning", scope, location, urgent: true,
      title: h.recovery === "failed" ? "Run recovery unavailable" : "Radio state unknown",
      message: `${reason}${bound === null ? "" : ` RF may continue until ${gpsClock(bound)} GPS (${utcClock(bound, view.leap)} UTC).`}${queued ? " Stop is queued." : ""}`,
      actions: [{ id: "retry", label: "Retry now", run: () => retry(h.key) }, ...(queued ? [] : [{ id: "stop", label: `Stop ${scope}`, run: () => stopHost(h.key) }])],
    });
  }

  const alarm = h.alarm;
  if (alarm !== null) problems.push({
    id: `${base}:alarm`, level: "error", scope, location, urgent: true,
    title: alarm.kind === "restarted" ? "Host restarted during a run" : "Run failed",
    message: alarm.kind === "restarted"
      ? `Run ${alarm.run} ended when LoomSky restarted; ${radioWord(h)}.`
      : `Run ${alarm.run} failed (${alarm.reason}): ${alarm.message}`,
    actions: [{ id: "acknowledge", label: "Acknowledge", run: () => acknowledge(h.key) }, openRun],
  });

  const refusal = view.refusal;
  if (refusal !== null && cls === "off") problems.push({
    id: `${base}:refused`, level: "warning", scope, location,
    title: "Transmission refused",
    message: `${refusal.source === null ? refusal.label || "The submission" : sourceWords(refusal.source)} refused (${refusal.reason}): ${refusal.message} Nothing was transmitted.`,
    actions: [{ id: "acknowledge", label: "Acknowledge", run: () => acknowledge(h.key) }, { id: "review-transmission", label: "Review transmission", run: () => openTransmit({ host: h.key }) }],
  });
  if (stopUnconfirmed(h, now)) problems.push({
    id: `${base}:stop`, level: "error", scope, location, urgent: true,
    title: "Stop not confirmed",
    message: `Stop is unconfirmed. Reported state: ${cls === "onair" ? "on air" : cls}.`,
    actions: [{ id: "stop", label: `Stop ${scope} again`, run: () => stopHost(h.key) }, { id: "retry", label: "Retry connection", run: () => retry(h.key) }],
  });
  if (cls !== "unknown" && h.link !== "ok" && h.link !== "none") problems.push({
    id: `${base}:connection`, level: "warning", scope, location,
    title: h.link === "token" ? "Host token refused" : h.link === "origin" ? "Page origin not allowed" : "Host connection unavailable",
    message: connectionMessage(h),
    actions: [{ id: "retry", label: "Retry connection", run: () => retry(h.key) }, { id: "device-settings", label: "Device settings", run: () => navigate({ workspace: "resource", kind: "host", id: h.key, tab: "device" }) }],
  });
  if (view.sourceError !== null) problems.push({
    id: `${base}:submission`, level: "error", scope, location,
    title: "Run snapshot unavailable", message: view.sourceError,
    actions: [{ id: "retry", label: "Retry loading", run: () => retry(h.key) }],
  });
  if (h.observationError !== null) problems.push({
    id: `${base}:observation`, level: "error", scope, location,
    title: "Cannot save host status",
    message: `Browser storage: ${h.observationError}`,
    actions: [{ id: "retry", label: "Retry", run: () => retry(h.key) }],
  });

  const status = view.status;
  const snapshot = view.snapshot;
  if (snapshot == null || status === null) return problems;
  const run = `${snapshot.boot}:${snapshot.run}`;
  status.commands.forEach((command, index) => {
    const result = command.applied;
    if (result === null || "epoch" in result) return;
    problems.push({
      id: `${base}:command:${run}:${index}`, level: "warning", scope, location: `Run ${snapshot.run}`,
      title: "rejected" in result ? "Command rejected" : "Command discarded",
      message: `${commandWords(command.command)}: ${"rejected" in result ? result.rejected : `discarded after run ${snapshot.run} ended (${result.discarded})`}.`,
      actions: [openRun],
    });
  });
  const faults = Object.entries(status.counts).filter(([, count]) => count > 0);
  if (faults.length > 0) problems.push({
    id: `${base}:faults:${run}`, level: "warning", scope, location: `Run ${snapshot.run}`,
    title: "Transmission faults reported",
    message: faults.map(([kind, count]) => `${count} ${kind}`).join(" · "),
    actions: [openRun],
  });
  return problems;
}

export function hostProblems(now: number): Problem[] {
  const state = hosts.get();
  const problems = state.list.flatMap((h) => problemsOf(h, now));

  const different = new Map<string, { name: string; version: number }[]>();
  for (const host of state.list) {
    const { cls, submission } = hostView(host, now);
    if (submission === null || !mayAir(cls) && cls !== "alarm") continue;
    const entry = scenarioCatalog.get().entries.get(submission.source.scenarioId);
    if (entry === undefined || entry.head.archivedAt !== null || submission.source.versionId === entry.head.headVersionId && !entry.working?.dirty && !entry.working?.pending) continue;
    const rows = different.get(entry.head.id) ?? [];
    rows.push({ name: nameOf(host), version: submission.source.versionNumber });
    different.set(entry.head.id, rows);
  }
  for (const [id, rows] of different) problems.push({
    id: `scenario:${id}:airing-revision`, level: "warning", scope: id,
    title: "Working copy differs from active runs",
    message: `${rows.map((row) => `${row.name} uses saved v${row.version}`).join("; ")}. Existing runs are unchanged. Review before transmitting again.`,
    actions: [{ id: "open-scenario", label: "Open scenario", run: () => navigate({ workspace: "resource", kind: "scenario", id, tab: "setup" }) }],
  });

  if (state.loadError !== null) problems.unshift({
    id: "hosts:storage", level: "error", scope: "Browser storage",
    title: "Cannot load saved hosts", message: state.loadError,
    actions: [{ id: "retry", label: "Retry saved hosts", run: retryHosts }],
  });
  return problems;
}
