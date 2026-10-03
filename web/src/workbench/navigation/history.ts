import { randomId } from "@/core";

export type HistoryEntry = { entryId: string; path: string };
type Visit = (entry: HistoryEntry) => string;

let frame: HistoryEntry | null = null;

function entryAt(path: string): HistoryEntry {
  const state: unknown = window.history.state;
  const entry = state !== null && typeof state === "object" && "loomsky" in state ? state.loomsky : null;
  return entry !== null && typeof entry === "object" && "entryId" in entry && typeof entry.entryId === "string"
    && "path" in entry && entry.path === path
    ? { entryId: entry.entryId, path } : { entryId: randomId(), path };
}

function write(entry: HistoryEntry, mode: "push" | "replace"): void {
  const current: unknown = window.history.state;
  const state = { ...(current !== null && typeof current === "object" ? current : {}), loomsky: entry };
  window.history[mode === "push" ? "pushState" : "replaceState"](state, "", entry.path);
  frame = entry;
}

export function startBrowserHistory(visit: Visit): () => void {
  const receive = () => {
    const entry = entryAt(`${window.location.pathname}${window.location.search}`);
    if (entry.entryId === frame?.entryId && entry.path === frame.path) return;
    frame = entry;
    write({ ...entry, path: visit(entry) }, "replace");
  };
  frame = null;
  receive();
  window.addEventListener("popstate", receive);
  return () => {
    window.removeEventListener("popstate", receive);
    frame = null;
  };
}

export function writeBrowserPage(entryId: string, path: string, history: "push" | "replace"): void {
  if (frame !== null) write({ entryId, path }, history);
}
