import { createStore } from "@/core";
import { deleteResource, getResourceHead, getSavedVersion, loadResourceHeads, onStorageChanges } from "@/io/storage";
import type { SaveState } from "@/model/document";
import { type ResourceHead, type ResourceKind, type ResourceSummary, type SavedResource, type SavedVersion } from "@/model/version";

export type DocumentWorkingSummary = Readonly<{ summary: ResourceSummary; dirty: boolean; pending: boolean; saveState: SaveState }>;
export type DocumentCatalogEntry = Readonly<{ head: ResourceHead; working: DocumentWorkingSummary | null }>;
export class DocumentMissingError extends Error {}

function sameSummary(left: ResourceSummary, right: ResourceSummary): boolean {
  return left === right || left.name === right.name && left.description === right.description
    && left.trajectoryId === right.trajectoryId && left.trajectoryVersionId === right.trajectoryVersionId
    && left.trajectoryVersionNumber === right.trajectoryVersionNumber
    && left.fileDigests.length === right.fileDigests.length && left.fileDigests.every((digest, index) => digest === right.fileDigests[index]);
}

function sameWorking(left: DocumentWorkingSummary | null | undefined, right: DocumentWorkingSummary | null): boolean {
  if (left === right) return true;
  if (left == null || right === null) return false;
  return left.dirty === right.dirty && left.pending === right.pending && sameSummary(left.summary, right.summary)
    && left.saveState.status === right.saveState.status
    && (left.saveState.status !== "error" || right.saveState.status === "error" && left.saveState.message === right.saveState.message);
}

type Document = {
  readonly id: string; readonly kind: ResourceKind; readonly summary: ResourceSummary;
  readonly pending: boolean; readonly canAdoptExternal: boolean;
  readonly saved: { readonly head: ResourceHead; readonly version: SavedVersion; readonly dirty: boolean; readonly state: SaveState; settled(): Promise<void> };
  readonly editing: { leaveView(): void; reset(): void };
  readonly view: { suspend(): void; resume(): void } | null;
  subscribe(listener: () => void): () => void;
  initialize(): Promise<void>;
  dispose(): void;
  reconcile(head: ResourceHead | null, version?: SavedVersion): void;
  remove(commit: () => Promise<void>): Promise<void>;
};
export function documentCollection<K extends ResourceKind, T extends Document>(kind: K, create: (resource: SavedResource<K>) => T) {
  const catalog = createStore<{ entries: ReadonlyMap<string, DocumentCatalogEntry>; order: string[]; version: number; loaded: boolean; loading: boolean; error: string | null }>({ entries: new Map(), order: [], version: 0, loaded: false, loading: false, error: null });
  const documents = createStore<{ docs: ReadonlyMap<string, T>; version: number }>({ docs: new Map(), version: 0 });
  type Visited = { doc: T; stop(): void; removing: boolean };
  const visited = new Map<string, Visited>();
  const openings = new Map<string, Promise<T>>();
  let loading: Promise<void> | null = null;
  let stopChanges: (() => void) | null = null;
  let generation = 0;
  let runtime = 0;
  let request = 0;
  const get = (id: string | null | undefined) => id == null ? undefined : visited.get(id)?.doc;
  const working = (doc: T): DocumentWorkingSummary => ({ summary: doc.summary, dirty: doc.saved.dirty, pending: doc.pending, saveState: doc.saved.state });
  function publish(doc: T): void {
    const previous = catalog.get().entries.get(doc.id);
    const known = previous?.head;
    const head = known !== undefined && known.revision >= doc.saved.head.revision ? known : doc.saved.head;
    const current = working(doc);
    if (previous?.head === head && sameWorking(previous.working, current)) return;
    catalog.set((state) => ({ entries: new Map(state.entries).set(doc.id, { head, working: current }), version: state.version + 1 }));
  }
  function register(doc: T): T {
    const entry: Visited = { doc, stop: () => {}, removing: false };
    visited.set(doc.id, entry);
    entry.stop = doc.subscribe(() => {
      publish(doc);
      documents.set((state) => ({ version: state.version + 1 }));
    });
    publish(doc);
    documents.set((state) => ({ docs: new Map(state.docs).set(doc.id, doc), version: state.version + 1 }));
    return doc;
  }
  async function open(id: string, options: { signal?: AbortSignal } = {}): Promise<T> {
    options.signal?.throwIfAborted();
    if (visited.get(id)?.removing) throw new DocumentMissingError("This resource is being deleted");
    const existing = get(id);
    if (existing !== undefined) return existing;
    let opening = openings.get(id);
    if (opening === undefined) {
      const currentGeneration = generation;
      opening = (async () => {
        await load();
        let resource: SavedResource<K>;
        let head = await getResourceHead(id);
        for (;;) {
          if (head === undefined) throw new DocumentMissingError("This resource is no longer in Library");
          const version = await getSavedVersion(head.headVersionId);
          const latest = await getResourceHead(id);
          if (latest?.revision !== head.revision) { head = latest; continue; }
          if (version?.kind !== kind || version.resourceId !== id) throw new Error("The saved resource is incomplete");
          resource = { head, version } as SavedResource<K>;
          break;
        }
        if (currentGeneration !== generation) throw new DOMException("The document registry closed", "AbortError");
        const existing = get(id);
        if (existing !== undefined) return existing;
        const doc = create(resource);
        try {
          await doc.initialize().catch(() => {});
          for (;;) {
            const latest = await getResourceHead(id);
            if (latest === undefined) throw new DocumentMissingError("This resource is no longer in Library");
            if (latest.revision === doc.saved.head.revision) break;
            const version = await getSavedVersion(latest.headVersionId);
            if (version?.kind !== kind) throw new Error("The saved resource is incomplete");
            doc.reconcile(latest, version);
            await doc.initialize().catch(() => {});
          }
          if (currentGeneration !== generation) throw new DOMException("The document registry closed", "AbortError");
          const installed = get(id);
          if (installed !== undefined) { doc.dispose(); return installed; }
          doc.reconcile(catalog.get().entries.get(id)?.head ?? null);
          return register(doc);
        } catch (error) { doc.dispose(); throw error; }
      })();
      openings.set(id, opening);
      const owned = opening;
      void opening.finally(() => { if (openings.get(id) === owned) openings.delete(id); }).catch(() => {});
    }
    const doc = await opening;
    options.signal?.throwIfAborted();
    return doc;
  }
  function refresh(): Promise<void> {
    request++;
    if (loading !== null) return loading;
    const currentGeneration = generation;
    catalog.set({ loading: true });
    loading = (async () => {
      for (;;) {
        const operation = request;
        const heads = await loadResourceHeads(kind);
        const versions = await Promise.all(heads.map((head) => { const doc = get(head.id); return doc?.canAdoptExternal && head.headVersionId !== doc.saved.version.id ? getSavedVersion(head.headVersionId) : undefined; }));
        if (currentGeneration !== generation) return;
        if (operation !== request) continue;
        const entries = new Map<string, DocumentCatalogEntry>();
        heads.forEach((head, index) => {
          const doc = get(head.id);
          doc?.reconcile(head, versions[index]);
          const previous = catalog.get().entries.get(head.id);
          const current = doc === undefined ? null : working(doc);
          entries.set(head.id, previous !== undefined && previous.head.revision === head.revision && previous.head.headVersionId === head.headVersionId
            && sameWorking(previous.working, current) ? previous : { head, working: current });
        });
        for (const entry of visited.values()) if (!entries.has(entry.doc.id)) entry.doc.reconcile(null);
        const order = heads.sort((a, b) => a.created - b.created).map((head) => head.id);
        catalog.set((state) => {
          const changed = state.entries.size !== entries.size || [...entries].some(([id, entry]) => state.entries.get(id) !== entry);
          const reordered = state.order.length !== order.length || state.order.some((id, index) => id !== order[index]);
          return { entries: changed ? entries : state.entries, order: reordered ? order : state.order, loaded: true, loading: false, error: null,
            version: state.version + Number(changed || reordered) };
        });
        return;
      }
    })().catch((error) => { if (currentGeneration === generation) catalog.set({ loading: false, error: error instanceof Error ? error.message : String(error) }); throw error; })
      .finally(() => { if (currentGeneration === generation) loading = null; });
    return loading;
  }
  const load = () => catalog.get().loaded && catalog.get().error === null ? Promise.resolve() : refresh();
  function start() {
    const owner = ++runtime;
    stopChanges ??= onStorageChanges((change) => { if (change === null || change.scope === "resources") void refresh().catch(() => {}); });
    return {
      setActive(active: boolean) { if (owner !== runtime) return; for (const entry of visited.values()) { if (active) entry.doc.view?.resume(); else { entry.doc.editing.leaveView(); entry.doc.view?.suspend(); } } },
      async close() {
        if (owner !== runtime) return;
        const closing = ++generation;
        stopChanges?.(); stopChanges = null; loading = null; openings.clear();
        const entries = [...visited.values()];
        for (const entry of entries) { entry.doc.editing.leaveView(); entry.doc.view?.suspend(); }
        await Promise.all(entries.map((entry) => entry.doc.saved.settled()));
        if (closing !== generation || owner !== runtime) return;
        for (const entry of entries) { entry.stop(); entry.doc.dispose(); visited.delete(entry.doc.id); }
        documents.set((state) => ({ docs: new Map(), version: state.version + 1 }));
      },
    };
  }
  function add(doc: T): T {
    request++;
    const existing = get(doc.id);
    if (existing !== undefined) { doc.dispose(); existing.reconcile(doc.saved.head, doc.saved.version); return existing; }
    register(doc);
    if (!catalog.get().order.includes(doc.id)) catalog.set((state) => ({ order: [...state.order, doc.id] }));
    return doc;
  }
  async function remove(id: string): Promise<void> {
    const doc = await open(id);
    const entry = visited.get(id)!;
    entry.removing = true;
    try {
      await doc.remove(() => deleteResource(id));
    } catch (error) { entry.removing = false; throw error; }
    entry.stop(); visited.delete(id);
    documents.set((state) => { const docs = new Map(state.docs); docs.delete(id); return { docs, version: state.version + 1 }; });
    await refresh();
  }
  function release(id: string): void {
    const entry = visited.get(id);
    if (entry === undefined) return;
    entry.stop();
    entry.doc.editing.reset();
    entry.doc.dispose();
    visited.delete(id);
    documents.set((state) => { const docs = new Map(state.docs); docs.delete(id); return { docs, version: state.version + 1 }; });
    catalog.set((state) => {
      const entries = new Map(state.entries);
      const previous = entries.get(id);
      if (previous !== undefined) entries.set(id, { head: previous.head, working: null });
      return { entries, version: state.version + 1 };
    });
  }
  return { catalog, documents, get, open, start, load, refresh, add, remove, release };
}
