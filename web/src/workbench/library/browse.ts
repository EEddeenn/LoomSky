import { createStore } from "@/core";
import type { ResourceRef } from "@/model/resource";
import { canRestoreViewport, captureViewport, createViewMemory, noteInteraction, page } from "@/workbench/navigation";
import type { LibraryFilter, LibrarySort } from "./types";

type LibraryBrowseState = {
  filter: LibraryFilter;
  query: string;
  sort: LibrarySort;
  selected: ResourceRef | null;
  scroll: number;
  previewOpen: boolean;
};

export const libraryBrowse = createStore<LibraryBrowseState>({ filter: "all", query: "", sort: "name", selected: null, scroll: 0, previewOpen: true });
const memory = createViewMemory<LibraryBrowseState>();

export function startLibraryBrowse(): () => void {
  let visit = -1;
  let release: (() => void) | null = null;
  const synchronize = () => {
    const state = page.get();
    if (visit === state.visitId) return;
    visit = state.visitId;
    release?.();
    release = null;
    if (state.route.workspace !== "library") return;
    const lease = captureViewport();
    const saved = memory.read(lease, "browse");
    if (saved !== undefined && canRestoreViewport(lease)) libraryBrowse.set(saved);
    release = memory.register(lease, "browse", () => ({ ...libraryBrowse.get() }));
  };
  const stop = page.subscribe(synchronize);
  synchronize();
  return () => { stop(); release?.(); };
}

export function setLibraryBrowse(patch: Partial<LibraryBrowseState>): void {
  if (Object.keys(patch).some((key) => key !== "scroll")) noteInteraction();
  libraryBrowse.set(patch);
}
