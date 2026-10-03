import { createStore } from "@/core";
import { archiveResource, deleteDraft, getResourceHead, getSavedVersion, loadDraftHeads, loadResourceHeads, onStorageChanges, readDraft, readSession, writeDraft, writeSession, type DraftHead } from "@/io/storage";
import type { SaveState } from "@/model/document";
import { type ResourceHead, type ResourceKind, type ResourceSummary, type SavedResource, type SavedVersion } from "@/model/version";
import { reportProblem, resolveProblem } from "@/workbench/feedback";
import { readDocumentCheckpoint, type DocumentCheckpoint } from "./checkpoint";

export type DocumentWorkingSummary = Readonly<{ summary: ResourceSummary; dirty: boolean; pending: boolean; recoverable: boolean; saveState: SaveState }>;
export type DocumentCatalogEntry = Readonly<{ head: ResourceHead; working: DocumentWorkingSummary | null }>;
export class DocumentMissingError extends Error {}

type Document = {
  readonly id: string; readonly kind: ResourceKind; readonly workingSequence: number; readonly summary: ResourceSummary;
  readonly pending: boolean; readonly recoverable: boolean; readonly canAdoptExternal: boolean;
  readonly saved: { readonly head: ResourceHead; readonly version: SavedVersion; readonly dirty: boolean; readonly state: SaveState; settled(): Promise<void> };
  readonly editing: { readonly busy: boolean; leaveView(): void };
  readonly view: { suspend(): void; resume(): void } | null;
  subscribe(listener: () => void): () => void;
  initialize(): Promise<void>;
  dispose(): void;
  checkpoint(): DocumentCheckpoint;
  restoreCheckpoint(checkpoint: never, resource: never): void;
  reconcile(head: ResourceHead | null, version?: SavedVersion): void;
  archive(commit: () => Promise<void>): Promise<void>;
};
const runtimeId = crypto.randomUUID();
const remembered = new Map<string, string>();
const hintKey = (kind: ResourceKind, id: string) => `view:draft:${kind}:${id}` as const;
const hint = (kind: ResourceKind, id: string) => remembered.get(hintKey(kind, id)) ?? readSession(hintKey(kind, id));
function remember(kind: ResourceKind, id: string, draft: string | null): void {
  const key = hintKey(kind, id);
  if (draft === null) remembered.delete(key); else remembered.set(key, draft);
  writeSession(key, draft ?? "");
}

export function documentCollection<K extends ResourceKind, T extends Document>(kind: K, create: (resource: SavedResource<K>) => T) {
  const catalog = createStore<{ entries: ReadonlyMap<string, DocumentCatalogEntry>; order: string[]; version: number; loaded: boolean; loading: boolean; error: string | null }>({ entries: new Map(), order: [], version: 0, loaded: false, loading: false, error: null });
  const documents = createStore<{ docs: ReadonlyMap<string, T>; version: number }>({ docs: new Map(), version: 0 });
  type Visited = { doc: T; stop(): void; timer?: ReturnType<typeof setTimeout>; persistence?: Promise<void>; draftId: string; revision: number | null; removing: boolean };
  const visited = new Map<string, Visited>();
  const openings = new Map<string, Promise<T>>();
  let loading: Promise<void> | null = null;
  let stopChanges: (() => void) | null = null;
  let generation = 0;
  let runtime = 0;
  let request = 0;
  const get = (id: string | null | undefined) => id == null ? undefined : visited.get(id)?.doc;
  const working = (doc: T): DocumentWorkingSummary => ({ summary: doc.summary, dirty: doc.saved.dirty, pending: doc.pending, recoverable: doc.recoverable, saveState: doc.saved.state });
  const token = (doc: T) => `${doc.workingSequence}:${doc.saved.version.id}:${doc.saved.head.revision}`;
  function publish(doc: T): void {
    const known = catalog.get().entries.get(doc.id)?.head;
    const head = known !== undefined && known.revision >= doc.saved.head.revision ? known : doc.saved.head;
    catalog.set((state) => ({ entries: new Map(state.entries).set(doc.id, { head, working: working(doc) }), version: state.version + 1 }));
    documents.set((state) => ({ version: state.version + 1 }));
  }
  function schedule(entry: Visited): void {
    if (entry.removing || entry.timer !== undefined) return;
    entry.timer = setTimeout(() => { entry.timer = undefined; void checkpoint(entry).catch(() => {}); }, 700);
  }
  async function checkpoint(entry: Visited): Promise<void> {
    if (entry.removing) return;
    if (entry.persistence !== undefined) { await entry.persistence; if (!entry.removing) return checkpoint(entry); return; }
    if (entry.doc.editing.busy || entry.doc.saved.state.status === "saving") { schedule(entry); return; }
    entry.persistence = (async () => {
      const doc = entry.doc;
      let before: string;
      do {
        before = token(doc);
        if (doc.recoverable) {
          const overlay = working(doc);
          const saved = await writeDraft({ id: entry.draftId, resourceId: doc.id, kind, runtimeId, baseVersionId: doc.saved.version.id,
            updatedAt: Date.now(), summary: overlay.summary, working: { dirty: overlay.dirty, pending: overlay.pending, recoverable: overlay.recoverable, saveState: overlay.saveState },
            expectedRevision: entry.revision, checkpoint: doc.checkpoint() });
          entry.revision = saved.revision;
          remember(kind, doc.id, saved.id);
        } else if (entry.revision !== null) {
          await deleteDraft(entry.draftId, entry.revision);
          entry.revision = null;
          remember(kind, doc.id, null);
        }
      } while (!entry.removing && before !== token(doc) && !doc.editing.busy && doc.saved.state.status !== "saving");
      resolveProblem(`draft:${kind}:${doc.id}`);
    })().catch((error) => {
      reportProblem({ id: `draft:${kind}:${entry.doc.id}`, level: "error", scope: entry.doc.summary.name, title: "Could not save recovery draft",
        message: `${error instanceof Error ? error.message : String(error)} Your working copy remains in this tab.`, actions: [{ id: "retry", label: "Retry", run: () => checkpoint(entry) }] });
      throw error;
    }).finally(() => { entry.persistence = undefined; });
    return entry.persistence;
  }
  function register(doc: T, draft?: DraftHead): T {
    const entry: Visited = { doc, stop: () => {}, draftId: draft?.runtimeId === runtimeId ? draft.id : crypto.randomUUID(), revision: draft?.runtimeId === runtimeId ? draft.revision : null, removing: false };
    visited.set(doc.id, entry);
    entry.stop = doc.subscribe(() => { publish(doc); schedule(entry); });
    documents.set((state) => ({ docs: new Map(state.docs).set(doc.id, doc), version: state.version + 1 }));
    publish(doc);
    if (draft !== undefined) schedule(entry);
    return doc;
  }
  async function baseOf(checkpoint: DocumentCheckpoint): Promise<SavedResource<K>> {
    const head = checkpoint.base;
    const version = await getSavedVersion(head.headVersionId);
    if (version === undefined) throw new Error("The draft’s saved version is unavailable. Its source and unapplied inputs remain in recovery storage.");
    if (version.resourceId !== head.id || version.kind !== kind || head.kind !== kind) throw new Error("The draft’s saved version belongs to another document");
    return { head, version } as SavedResource<K>;
  }
  async function open(id: string, options: { signal?: AbortSignal } = {}): Promise<T> {
    options.signal?.throwIfAborted();
    if (visited.get(id)?.removing) throw new DocumentMissingError("This resource is being archived");
    const existing = get(id);
    if (existing !== undefined) return existing;
    let opening = openings.get(id);
    if (opening === undefined) {
      const currentGeneration = generation;
      opening = (async () => {
        await load();
        const draftId = hint(kind, id);
        const draft = draftId ? await readDraft(draftId) : undefined;
        const stored = draft?.head.resourceId === id && draft.head.kind === kind ? readDocumentCheckpoint(draft.checkpoint, kind, id) : null;
        let resource: SavedResource<K>;
        if (stored !== null) resource = await baseOf(stored);
        else {
          let head = await getResourceHead(id);
          for (;;) {
            if (head === undefined || head.archivedAt !== null) throw new DocumentMissingError("This resource is no longer in the active Library");
            const version = await getSavedVersion(head.headVersionId);
            const latest = await getResourceHead(id);
            if (latest?.revision !== head.revision) { head = latest; continue; }
            if (version?.kind !== kind || version.resourceId !== id) throw new Error("The saved resource is incomplete");
            resource = { head, version } as SavedResource<K>;
            break;
          }
        }
        if (currentGeneration !== generation) throw new DOMException("The document registry closed", "AbortError");
        const existing = get(id);
        if (existing !== undefined) return existing;
        const doc = create(resource);
        try {
          if (stored !== null) doc.restoreCheckpoint(stored as never, resource as never);
          await doc.initialize().catch(() => {});
          while (stored === null) {
            const latest = await getResourceHead(id);
            if (latest === undefined || latest.archivedAt !== null) throw new DocumentMissingError("This resource is no longer in the active Library");
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
          return register(doc, stored === null ? undefined : draft!.head);
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
        const [heads, drafts] = await Promise.all([loadResourceHeads(kind, true), loadDraftHeads()]);
        const versions = await Promise.all(heads.map((head) => { const doc = get(head.id); return doc?.canAdoptExternal && head.archivedAt === null && head.headVersionId !== doc.saved.version.id ? getSavedVersion(head.headVersionId) : undefined; }));
        if (currentGeneration !== generation) return;
        if (operation !== request) continue;
        const entries = new Map<string, DocumentCatalogEntry>();
        heads.forEach((head, index) => {
          const doc = get(head.id);
          doc?.reconcile(head, versions[index]);
          const draft = drafts.find((item) => item.id === hint(kind, head.id) && item.kind === kind);
          entries.set(head.id, { head, working: doc === undefined ? draft === undefined ? null : { summary: draft.summary, ...draft.working } : working(doc) });
        });
        for (const entry of visited.values()) if (!entries.has(entry.doc.id)) entry.doc.reconcile(null);
        catalog.set((state) => ({ entries, order: heads.filter((head) => head.archivedAt === null).sort((a, b) => a.created - b.created).map((head) => head.id), loaded: true, loading: false, error: null, version: state.version + 1 }));
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
      setActive(active: boolean) { if (owner !== runtime) return; for (const entry of visited.values()) { if (active) entry.doc.view?.resume(); else { entry.doc.editing.leaveView(); entry.doc.view?.suspend(); void checkpoint(entry).catch(() => {}); } } },
      async close() {
        if (owner !== runtime) return;
        const closing = ++generation;
        stopChanges?.(); stopChanges = null; loading = null; openings.clear();
        const entries = [...visited.values()];
        for (const entry of entries) { clearTimeout(entry.timer); entry.timer = undefined; entry.doc.editing.leaveView(); entry.doc.view?.suspend(); }
        await Promise.all(entries.map(async (entry) => { await entry.doc.saved.settled(); await checkpoint(entry); }));
        if (closing !== generation || owner !== runtime) return;
        for (const entry of entries) { clearTimeout(entry.timer); entry.stop(); entry.doc.dispose(); visited.delete(entry.doc.id); }
        documents.set((state) => ({ docs: new Map(), version: state.version + 1 }));
      },
    };
  }
  function add(doc: T): T {
    request++;
    const existing = get(doc.id);
    if (existing !== undefined) { doc.dispose(); existing.reconcile(doc.saved.head, doc.saved.version); return existing; }
    register(doc);
    catalog.set((state) => ({ order: state.order.includes(doc.id) ? state.order : [...state.order, doc.id] }));
    return doc;
  }
  async function archive(id: string): Promise<void> {
    const doc = await open(id);
    const entry = visited.get(id)!;
    entry.removing = true;
    clearTimeout(entry.timer); entry.timer = undefined;
    try {
      await entry.persistence;
      await doc.archive(() => archiveResource(id, doc.saved.head.revision));
      entry.stop(); visited.delete(id); remember(kind, id, null);
      documents.set((state) => { const docs = new Map(state.docs); docs.delete(id); return { docs, version: state.version + 1 }; });
      if (entry.revision !== null) await deleteDraft(entry.draftId, entry.revision);
      await refresh();
    } catch (error) { entry.removing = false; schedule(entry); throw error; }
  }
  async function restoreDraft(head: DraftHead): Promise<void> {
    const currentGeneration = generation;
    const current = () => { if (currentGeneration !== generation) throw new DOMException("The document registry closed", "AbortError"); };
    if (head.kind !== kind) throw new Error("Choose a draft of this resource type");
    const stored = await readDraft(head.id);
    current();
    if (stored?.head.revision !== head.revision) throw new Error("This draft changed. Refresh the draft list");
    const captured = readDocumentCheckpoint(stored.checkpoint, kind, head.resourceId);
    const previous = visited.get(head.resourceId);
    if (previous?.doc.editing.busy || previous?.doc.saved.state.status === "saving") throw new Error("Finish editing or saving before recovering a draft");
    const before = previous === undefined ? null : token(previous.doc);
    const resource = await baseOf(captured);
    current();
    if (visited.get(head.resourceId) !== previous) throw new Error("The working copy changed while loading the draft");
    if (previous !== undefined) await checkpoint(previous);
    current();
    if (visited.get(head.resourceId) !== previous || previous !== undefined && before !== token(previous.doc)) throw new Error("The working copy changed while loading the draft");
    const doc = previous?.doc ?? create(resource);
    doc.restoreCheckpoint(captured as never, resource as never);
    if (previous === undefined) register(doc);
    const entry = visited.get(doc.id)!;
    entry.draftId = crypto.randomUUID(); entry.revision = null;
    await doc.initialize().catch(() => {});
    current();
    doc.reconcile(catalog.get().entries.get(doc.id)?.head ?? null);
    await checkpoint(entry);
  }
  function draftDiscarded(head: DraftHead): void {
    if (hint(kind, head.resourceId) === head.id) remember(kind, head.resourceId, null);
    const entry = visited.get(head.resourceId);
    if (entry?.draftId === head.id) { entry.draftId = crypto.randomUUID(); entry.revision = null; schedule(entry); }
    void refresh().catch(() => {});
  }
  return { catalog, documents, get, open, start, load, refresh, add, archive, restoreDraft, draftDiscarded };
}
