import { randomId } from "@/core";

type HistoryEntry = { entryId: string; path: string; readonly index: number };
type Visit = (entry: HistoryEntry) => string | null;

let frame: HistoryEntry | null = null;
let restoring = false;
let afterRestore: (() => void) | null = null;

function entryAt(path: string): HistoryEntry {
  const state: unknown = window.history.state;
  const entry = state !== null && typeof state === "object" && "loomsky" in state ? state.loomsky : null;
  const index = entry !== null && typeof entry === "object" && "index" in entry
    && typeof entry.index === "number" && Number.isSafeInteger(entry.index)
    ? entry.index : frame === null ? 0 : frame.index - 1;
  return entry !== null && typeof entry === "object" && "entryId" in entry && typeof entry.entryId === "string"
    && "path" in entry && entry.path === path
    ? { entryId: entry.entryId, path, index } : { entryId: randomId(), path, index };
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
    if (entry.entryId === frame?.entryId && entry.path === frame.path) {
      restoring = false;
      const resume = afterRestore;
      afterRestore = null;
      resume?.();
      return;
    }
    if (restoring) return;
    const path = visit(entry);
    if (path === null && frame !== null) {
      restoring = true;
      window.history.go(frame.index - entry.index);
      return;
    }
    write({ ...entry, path: path ?? entry.path }, "replace");
  };
  frame = null;
  restoring = false;
  afterRestore = null;
  receive();
  window.addEventListener("popstate", receive);
  return () => {
    window.removeEventListener("popstate", receive);
    frame = null;
    restoring = false;
    afterRestore = null;
  };
}

export function writeBrowserPage(entryId: string, path: string, history: "push" | "replace"): void {
  const update = () => {
    if (frame === null) return;
    write({ entryId, path, index: frame.index + (history === "push" ? 1 : 0) }, history);
  };
  if (restoring) afterRestore = update;
  else update();
}

export function resumeBrowserPage(entry: HistoryEntry): void {
  const resume = () => {
    if (frame !== null && entry.index !== frame.index) window.history.go(entry.index - frame.index);
  };
  if (restoring) afterRestore = resume;
  else resume();
}
