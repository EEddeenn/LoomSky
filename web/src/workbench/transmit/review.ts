import { packedLeap } from "@/model/bundle";
import { gpsClock, utcClock } from "@/model/gnss";
import { mmss, offset } from "@/core";
import { reportProblem } from "@/workbench/feedback";
import { hostOf, nameOf, type Host } from "@/workbench/hosts";
import { transmit, transmissionSnapshot, type TransmissionConfig } from "@/workbench/hosts/actions";
import { libraryPicker } from "@/workbench/library";
import { captureAttention, closePageSession, hasAttention, openResource } from "@/workbench/navigation";
import { liveWindowIssue, resolveConfiguration } from "./configuration";
import { configurationOf, setReviewError, transmissionOwner, updateTransmission, type TransmissionSession } from "./session";

export type TransmissionReview = {
  host: Host;
  registration: string;
  snapshot: string;
  config: TransmissionConfig;
  details: { label: string; value: string }[];
};

function registrationIdentity(host: Host): string {
  const { id, address, token, gain } = host.record;
  return JSON.stringify([id, address, token, gain]);
}

export function reviewTransmission(session: TransmissionSession): void {
  if (transmissionOwner(session) === null || libraryPicker.get().session !== null || session.sending) return;
  const resolved = configurationOf(session, Date.now()).config;
  if (resolved.kind === "blocked") { setReviewError(session, resolved.issue); return; }
  const { host, config } = resolved;
  const source = session.source;
  const leap = packedLeap(source.window);
  const end = source.window.startGpsMs + source.window.durationMs;
  updateTransmission(session, { review: {
    host, registration: registrationIdentity(host), snapshot: transmissionSnapshot(host), config,
    details: [
      { label: "Radio host", value: `${nameOf(host)} · ${host.record.address}` },
      { label: "Scenario", value: `${source.resourceId} v${source.versionNumber}` },
      { label: "Bundle", value: source.digest },
      { label: "Start", value: config.replayMs === null ? "Live · GPS time" : `Replay from ${offset(config.replayMs, true)}` },
      { label: "Window", value: `${gpsClock(source.window.startGpsMs)} → ${gpsClock(end)} GPS · ${utcClock(source.window.startGpsMs, leap)} → ${utcClock(end, leap)} UTC` },
      { label: "Duration", value: config.replayMs === null ? `Until ${gpsClock(end)} GPS` : mmss(source.window.durationMs - config.replayMs) },
      { label: "Gain", value: `${config.gainDb} dB` },
    ],
  } });
}

export async function sendTransmission(session: TransmissionSession): Promise<void> {
  const owner = transmissionOwner(session);
  const request = session.review;
  if (owner === null || request === null || session.sending) return;
  const { host, config } = request;
  const source = session.source;
  const resolved = resolveConfiguration(host, source, config, Date.now());
  if (hostOf(host.key) !== host || registrationIdentity(host) !== request.registration || transmissionSnapshot(host) !== request.snapshot || resolved.kind === "blocked") {
    setReviewError(session, resolved.kind === "blocked" ? resolved.issue : "Transmitter changed. Review again.");
    return;
  }
  updateTransmission(session, { review: request, sending: true });
  const attention = captureAttention();
  try {
    await transmit(host, {
      source: { scenarioId: source.resourceId, versionId: source.versionId, versionNumber: source.versionNumber, buildId: source.buildId, engineIdentity: source.engineIdentity },
      digest: source.digest, label: `${source.resourceId} v${source.versionNumber}`,
      texts: source.input, bundle: source.bundle, summary: source.summary,
    }, config, () => {
      owner.signal.throwIfAborted();
      const issue = liveWindowIssue(host, source, config, Date.now());
      if (issue !== "") throw new Error(issue);
    });
    const follow = hasAttention(attention);
    closePageSession(owner);
    if (follow && hostOf(host.key) === host) openResource({ kind: "host", key: host.key });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (transmissionOwner(session) !== null) updateTransmission(session, { sending: false, reviewError: message });
    else if (!(error instanceof DOMException && error.name === "AbortError")) reportProblem({ id: `transmit:${host.key}`, scope: "Transmission", level: "error", title: "Transmission incomplete", message });
  }
}
