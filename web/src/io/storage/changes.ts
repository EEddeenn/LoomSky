import { onStorageCommit, onStorageUnavailable } from "./database";
import type { StorageChange } from "./protocol";

const listeners = new Set<(change: StorageChange | null) => void>();
const scopes = new Set(["resources", "libraryFiles", "builds", "hosts", "submissions", "pending", "stops", "basemaps"]);
let stopSync: (() => void) | undefined;

export function onStorageChanges(listener: (change: StorageChange | null) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function startStorageSync(): () => void {
  if (stopSync !== undefined) return stopSync;
  let closed = false;
  let channel: BroadcastChannel | null = null;
  try { channel = new BroadcastChannel("loomsky-storage"); } catch {}
  const notify = (change: StorageChange | null): void => {
    if (closed) return;
    for (const listener of listeners) {
      try { listener(change); } catch (error) { console.error(error); }
    }
  };
  if (channel !== null) channel.onmessage = (event: MessageEvent<unknown>) => {
    const change = event.data;
    if (typeof change !== "object" || change === null || !("scope" in change) || typeof change.scope !== "string" || !scopes.has(change.scope)
      || !("key" in change) || typeof change.key !== "string"
      || change.scope === "builds" && (!("versionId" in change) || typeof change.versionId !== "string")) return;
    notify(change as StorageChange);
  };
  const unsubscribe = onStorageCommit((change) => {
    try { channel?.postMessage(change); } catch {}
    notify(change);
  });
  const wake = (): void => notify(null);
  const visible = (): void => { if (document.visibilityState === "visible") wake(); };
  window.addEventListener("focus", wake);
  window.addEventListener("pageshow", wake);
  document.addEventListener("visibilitychange", visible);
  let unsubscribeUnavailable = (): void => {};
  const stop = (): void => {
    if (closed) return;
    closed = true;
    unsubscribe();
    unsubscribeUnavailable();
    channel?.close();
    window.removeEventListener("focus", wake);
    window.removeEventListener("pageshow", wake);
    document.removeEventListener("visibilitychange", visible);
    stopSync = undefined;
  };
  stopSync = stop;
  unsubscribeUnavailable = onStorageUnavailable(stop);
  wake();
  return stop;
}
