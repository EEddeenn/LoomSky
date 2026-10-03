import { isLive, type Snapshot } from "./protocol";
import { snapshotWindow, type SubmissionRecord } from "./submission";

type HostSeen = { boot: string; run: number; live: boolean; startGps: number | null; endGps: number | null; sentGps: number | null; replay: boolean; at: number };
export type HostRegistrationRecord = { id: string; address: string; order: number; token: string; name: string; gain: string | null; seen: HostSeen | null };

export function observationOf(address: string, snapshot: Snapshot, submission: SubmissionRecord | null, at: number): HostSeen {
  const status = snapshot.status;
  const window = snapshotWindow(address, snapshot, submission);
  return {
    boot: snapshot.boot,
    run: snapshot.run,
    live: isLive(status),
    startGps: window?.startGpsMs ?? null,
    endGps: window === null ? null : window.startGpsMs + window.durationMs,
    sentGps: window !== null && status?.sent != null ? window.startGpsMs + status.sent : null,
    replay: status?.config.replay_ms != null,
    at,
  };
}
