import { isSnapshot, type Snapshot } from "@/model/host";

export type Answer = { kind: "status"; snapshot: Snapshot } | { kind: "token" } | { kind: "origin" } | { kind: "noanswer" } | { kind: "http"; code: number };

export type Poll = { sentAt: number; receivedAt: number } & Answer;

export function baseOf(address: string): string {
  const trimmed = address.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export async function ask(watch: { base: string; token: string }, timeoutMs: number, signal?: AbortSignal): Promise<Answer> {
  signal?.throwIfAborted();
  let response: Response;
  try {
    const timeout = AbortSignal.timeout(timeoutMs);
    response = await fetch(`${watch.base}/status`, { headers: { authorization: `Bearer ${watch.token}` }, cache: "no-store", signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]) });
  } catch {
    signal?.throwIfAborted();
    try {
      const timeout = AbortSignal.timeout(timeoutMs);
      await fetch(`${watch.base}/status`, { mode: "no-cors", cache: "no-store", signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]) });
      signal?.throwIfAborted();
      return { kind: "origin" };
    } catch {
      signal?.throwIfAborted();
      return { kind: "noanswer" };
    }
  }
  signal?.throwIfAborted();
  if (response.status === 401) return { kind: "token" };
  if (response.status !== 200) return { kind: "http", code: response.status };
  try {
    const body: unknown = await response.json();
    signal?.throwIfAborted();
    return isSnapshot(body) ? { kind: "status", snapshot: body } : { kind: "http", code: 200 };
  } catch {
    signal?.throwIfAborted();
    return { kind: "http", code: 200 };
  }
}

export function startStatusPoller(address: string, token: string, rate: () => number, receive: (poll: Poll) => void, signal: AbortSignal): { now(): void; close(): void } {
  const controller = new AbortController();
  const watch = { base: baseOf(address), token };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let busy = false;

  const close = () => {
    clearTimeout(timer);
    controller.abort();
    signal.removeEventListener("abort", close);
  };
  const poll = async () => {
    if (controller.signal.aborted || busy) return;
    clearTimeout(timer);
    busy = true;
    const sentAt = Date.now();
    try {
      const answer = await ask(watch, 1000, controller.signal).catch(() => ({ kind: "noanswer" } as const));
      if (!controller.signal.aborted) receive({ ...answer, sentAt, receivedAt: Date.now() });
    } finally {
      busy = false;
      if (!controller.signal.aborted) timer = setTimeout(() => { void poll(); }, Math.max(0, sentAt + 1000 / rate() - Date.now()));
    }
  };
  if (signal.aborted) close();
  else { signal.addEventListener("abort", close, { once: true }); void poll(); }
  return { now: () => { void poll(); }, close };
}
