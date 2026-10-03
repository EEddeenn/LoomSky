import { randomId } from "@/core";
import { hostsDb } from "@/io/storage";
import type { Snapshot } from "@/model/host";
import { log, reportProblem, resolveProblem, toast } from "@/workbench/feedback";
import { recover } from "../lifecycle";
import { changed, hostFrom, hostOf, hosts, nameOf, type Host } from "../state";

let restoring: { signal?: AbortSignal; promise: Promise<boolean> } | null = null;

function hostStorageFailure(error: unknown): void {
  hosts.set({ loadError: error instanceof Error ? error.message : String(error) });
}

export function restoreHosts(signal?: AbortSignal): Promise<boolean> {
  if (restoring !== null && restoring.signal === signal) return restoring.promise;
  const request = { signal, promise: Promise.resolve(false) };
  restoring = request;
  request.promise = hostsDb.all().then((records) => {
    if (signal?.aborted) return false;
    hosts.set((current) => ({
      list: records.map((record) => {
        const h = current.list.find((h) => h.record.id === record.id && h.key === record.address);
        if (h === undefined) return hostFrom(record);
        const observed = h.record.seen;
        h.record = observed !== null && (record.seen === null || observed.at > record.seen.at)
          ? { ...record, name: h.record.name, seen: observed }
          : record;
        h.savedObservationAt = record.seen?.at ?? null;
        return h;
      }),
      loaded: true,
      loadError: null,
    }));
    return true;
  }).catch((error) => {
    if (!signal?.aborted) hostStorageFailure(error);
    return false;
  }).finally(() => { if (restoring === request) restoring = null; });
  return request.promise;
}

export async function persistObservations(signal?: AbortSignal): Promise<void> {
  await Promise.all(hosts.get().list.map(async (h) => {
    const { address, id, name, seen } = h.record;
    if (signal?.aborted || h.savingObservation || seen === null || seen.at === h.savedObservationAt && h.observationError === null) return;
    h.savingObservation = true;
    try {
      const saved = await hostsDb.updateObservation(address, id, { name, seen });
      if (signal?.aborted || hostOf(h.key) !== h || h.record.id !== id) return;
      h.savedObservationAt = seen.at;
      if (saved && h.observationError !== null) {
        h.observationError = null;
        changed();
      }
    } catch (error) {
      if (signal?.aborted || hostOf(h.key) !== h || h.record.id !== id) return;
      const message = error instanceof Error ? error.message : String(error);
      if (h.observationError !== message) {
        h.observationError = message;
        changed();
      }
    } finally {
      h.savingObservation = false;
    }
  }));
}

async function registrationChanged(): Promise<void> {
  await retryHosts();
  toast("Host changed in another tab. Review and retry.", "warning");
}

export async function addHost(address: string, token: string, snapshot: Snapshot): Promise<boolean> {
  const key = address.trim();
  const problemId = `host:${key}:add`;
  if (!await restoreHosts()) return false;
  void recover();
  if (hostOf(key) !== undefined) {
    resolveProblem(problemId);
    return true;
  }
  let h: Host;
  try {
    h = hostFrom(await hostsDb.add({ id: randomId(), address: key, token, name: snapshot.station.name, gain: null, seen: null }));
  } catch (error) {
    reportProblem({
      id: problemId, level: "error", scope: "Transmitters", title: "Host could not be added", location: key,
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
  resolveProblem(problemId);
  if (hostOf(key) !== undefined) return true;
  if (h.record.address === key && h.record.token === token) h.snapshot = snapshot;
  hosts.set((s) => ({ list: [...s.list, h] }));
  void recover();
  log(nameOf(h), `Add host · ${key}`, "action");
  return true;
}

export async function removeRegisteredHost(key: string, registrationId: string): Promise<void> {
  const h = hostOf(key);
  if (h === undefined || h.record.id !== registrationId) throw new Error("Registration changed. Review the transmitter before removing it.");
  const removed = await hostsDb.remove(h.record.address, registrationId);
  if (!removed) {
    await retryHosts();
    throw new Error("Registration changed. Review the transmitter before removing it.");
  }
  hosts.set((s) => ({ list: s.list.filter((x) => x !== h) }));
}

export async function saveCredentials(h: Host, patch: { token: string } | { gain: string }, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return false;
  const registration = { id: h.record.id, address: h.record.address };
  const field = "token" in patch ? "token" : "gain";
  const problemId = `host:${registration.address}:settings:${registration.id}:${field}`;
  try {
    if (!await hostsDb.updateCredentials(registration.address, registration.id, patch)) {
      if (signal?.aborted) return false;
      await registrationChanged();
      return false;
    }
  } catch (error) {
    if (signal?.aborted) return false;
    reportProblem({
      id: problemId, level: "error", scope: nameOf(h), title: `Could not save ${field}`, location: registration.address,
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
  if (signal?.aborted) return false;
  resolveProblem(problemId);
  if (hostOf(h.key) !== h || h.record.id !== registration.id || h.record.address !== registration.address) return false;
  h.record = { ...h.record, ...patch };
  changed();
  return true;
}

export async function setToken(key: string, token: string): Promise<boolean> {
  const h = hostOf(key);
  return h !== undefined && await saveCredentials(h, { token });
}

export async function forgetToken(key: string): Promise<void> {
  const h = hostOf(key);
  if (h === undefined || !await setToken(key, "")) return;
  toast(`Forgot ${nameOf(h)}'s token`);
  log(nameOf(h), "Forget token", "action");
}

export async function retryHosts(): Promise<void> {
  if (!await restoreHosts()) return;
  await recover();
}
