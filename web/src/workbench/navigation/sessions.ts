import { noteInteraction } from "./attention";

export type PageSession = Readonly<{ id: number; signal: AbortSignal }>;

let nextSession = 0;
const sessions = new Map<PageSession, () => void>();

export function createPageSession(options: { parent?: PageSession; onClose(): void }): PageSession {
  const controller = new AbortController();
  const handle = { id: ++nextSession, signal: controller.signal };
  if (options.parent !== undefined && !isPageSession(options.parent)) {
    controller.abort();
    return handle;
  }
  const close = () => {
    if (!sessions.delete(handle)) return;
    options.parent?.signal.removeEventListener("abort", close);
    controller.abort();
    noteInteraction();
    options.onClose();
  };
  sessions.set(handle, close);
  options.parent?.signal.addEventListener("abort", close, { once: true });
  return handle;
}

export function isPageSession(session: PageSession): boolean {
  return sessions.has(session) && !session.signal.aborted;
}

export function closePageSession(session: PageSession): void {
  sessions.get(session)?.();
}

export function closePageSessions(): void {
  for (const close of [...sessions.values()]) close();
}
