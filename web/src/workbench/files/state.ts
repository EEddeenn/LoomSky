import { reserveInput } from "@/io/input";
import { createStore } from "@/core";
import { createLibraryFile, deleteLibraryFile, loadLibraryFiles, renameLibraryFileRecord, onStorageChanges, type ResourceWriteOptions } from "@/io/storage";
import type { LibraryFileRecord } from "@/model/library";

export const fileLibrary = createStore<{
  items: ReadonlyMap<string, LibraryFileRecord>;
  order: string[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
}>({ items: new Map(), order: [], loaded: false, loading: false, error: null });

export function libraryFileOf(id: string | null | undefined): LibraryFileRecord | undefined {
  return id == null ? undefined : fileLibrary.get().items.get(id);
}

let loading: Promise<void> | null = null;
let generation = 0;
let request = 0;
let active = false;

export function reloadFileLibrary(): Promise<void> {
  request++;
  if (loading !== null) return loading;
  const lifetime = generation;
  fileLibrary.set({ loading: true });
  const task = (async () => {
    while (lifetime === generation) {
      const current = request;
      const items = await loadLibraryFiles();
      if (lifetime !== generation) return;
      if (current !== request) continue;
      const records = items.toSorted((a, b) => a.created - b.created);
      fileLibrary.set({
        items: new Map(records.map((record) => [record.id, record])),
        order: records.map((record) => record.id), loaded: true, loading: false, error: null,
      });
      return;
    }
  })().catch((error: unknown) => {
    if (lifetime === generation) fileLibrary.set({ loading: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }).finally(() => { if (loading === task) loading = null; });
  loading = task;
  return task;
}

export function startFileLibrary(): () => void {
  active = true;
  const stop = onStorageChanges((change) => {
    if (change === null || change.scope === "libraryFiles") void reloadFileLibrary().catch(() => undefined);
  });
  void reloadFileLibrary().catch(() => undefined);
  return () => { active = false; stop(); generation++; loading = null; fileLibrary.set({ loading: false }); };
}

async function refreshAfterWrite(): Promise<void> {
  if (active) await reloadFileLibrary().catch(() => undefined);
}

export async function importLibraryFile(file: File, options: ResourceWriteOptions = {}): Promise<{ record: LibraryFileRecord; created: boolean }> {
  options.signal?.throwIfAborted();
  const release = reserveInput(file.size, options.signal);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    options.signal?.throwIfAborted();
    const result = await createLibraryFile(file.name, bytes, options);
    await refreshAfterWrite();
    return result;
  } finally { release(); }
}

export async function renameLibraryFile(id: string, name: string, expectedRevision: number): Promise<void> {
  try { await renameLibraryFileRecord(id, name, expectedRevision); }
  finally { await refreshAfterWrite(); }
}

export async function removeLibraryFile(id: string, expectedRevision: number): Promise<void> {
  try { await deleteLibraryFile(id, expectedRevision); }
  finally { await refreshAfterWrite(); }
}
