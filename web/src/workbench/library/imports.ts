import { createStore, randomId, useStore } from "@/core";
import { hasAttention, captureAttention } from "@/workbench/navigation";
import { startImport } from "@/workbench/operations";
import { acceptLibraryImports, libraryPicker } from "./picker";
import { setLibraryBrowse } from "./browse";
import type { ImportKind } from "@/workbench/operations";

export type { ImportKind } from "@/workbench/operations";

const imports = createStore<{ pending: ReadonlyMap<string, number | null> }>({ pending: new Map() });

export function useLibraryImporting(pickerId: number | null): boolean {
  return useStore(imports, (state) => [...state.pending.values()].some((owner) => owner === pickerId));
}

export async function importResources(kind: ImportKind, files: readonly File[], picker: boolean): Promise<void> {
  if (files.length === 0) return;
  const pickerId = picker ? libraryPicker.get().session?.id : null;
  if (pickerId === undefined) return;
  const attention = captureAttention();
  const handle = startImport({ batchId: randomId(), kind, files });
  imports.set((state) => ({ pending: new Map(state.pending).set(handle.id, pickerId) }));
  const operation = await handle.done;
  imports.set((state) => {
    const pending = new Map(state.pending);
    pending.delete(handle.id);
    return { pending };
  });
  const resources = operation.items.flatMap((item) => item.status !== "succeeded" || item.resource === null ? [] : [item.resource]);
  const first = resources[0];
  if (first === undefined || !hasAttention(attention)) return;
  if (pickerId === null) {
    setLibraryBrowse({ selected: first, filter: kind, query: "", scroll: 0, previewOpen: true });
    return;
  }
  await acceptLibraryImports(pickerId, resources);
}
