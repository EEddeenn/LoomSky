import { sha256 } from "@/core";
import type { HostRegistrationRecord, PendingSubmissionRecord, RunKnowledgeRecord, StopIntentRecord, SubmissionRecord } from "@/model/host";
import type { LibraryFileRecord } from "@/model/library";
import { canonicalContent, resourceSummary, savedSnapshotDigest, type BuildRecord, type ResourceHead, type SavedVersion, type SuccessfulTrajectoryBuild, type TrajectorySavedVersion } from "@/model/version";
import type { DraftHead, StorageChange } from "./protocol";

export type FileRecord = { digest: string; bytes: Uint8Array<ArrayBuffer> };
declare const verifiedFile: unique symbol;
export type VerifiedFileRecord = FileRecord & { readonly [verifiedFile]: true };

type Stores = {
  resourceHeads: ResourceHead;
  savedVersions: SavedVersion;
  builds: BuildRecord;
  files: FileRecord;
  fileMetadata: { digest: string; size: number };
  draftHeads: DraftHead;
  draftBodies: { id: string; checkpoint: unknown };
  libraryFiles: LibraryFileRecord;
  submissions: Omit<SubmissionRecord, "truth">;
  runKnowledge: RunKnowledgeRecord;
  pending: PendingSubmissionRecord;
  stops: StopIntentRecord;
  hosts: HostRegistrationRecord;
  basemaps: { url: string };
};
export type StoreName = keyof Stores;

const originalStores = {
  resourceHeads: "id", savedVersions: "id", builds: "id",
  files: "digest", libraryFiles: "id",
  submissions: "key", pending: "key", stops: "key",
  hosts: "address",
};
const commitListeners = new Set<(change: StorageChange) => void>();
const unavailableListeners = new Set<(error: StorageUnavailableError) => void>();
let database: Promise<IDBDatabase> | undefined;
let unavailable: StorageUnavailableError | undefined;
let runtime = 0;
let connectionGeneration = 0;
let closed = false;

export class StorageError extends Error {
  constructor(action: string, cause: unknown) {
    super(`Could not ${action} browser storage: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "StorageError";
  }
}

export class StorageConflictError extends Error {}

export class StorageUnavailableError extends Error {
  constructor() {
    super("Browser storage changed in another tab. Reload to continue.");
    this.name = "StorageUnavailableError";
  }
}

export class StorageClosedError extends Error {
  constructor() {
    super("The workbench storage session is closed.");
    this.name = "StorageClosedError";
  }
}

export function startStorage(): () => Promise<void> {
  const owner = ++runtime;
  closed = false;
  return async () => {
    if (owner !== runtime || closed) return;
    closed = true;
    connectionGeneration++;
    const pending = database;
    database = undefined;
    if (pending !== undefined) await pending.then((db) => db.close(), () => undefined);
  };
}

function notify<T>(listeners: Set<(value: T) => void>, value: T): void {
  for (const listener of listeners) {
    try { listener(value); } catch (error) { console.error(error); }
  }
}

export function onStorageCommit(listener: (change: StorageChange) => void): () => void {
  commitListeners.add(listener);
  return () => { commitListeners.delete(listener); };
}

export function onStorageUnavailable(listener: (error: StorageUnavailableError) => void): () => void {
  if (unavailable !== undefined) {
    listener(unavailable);
    return () => {};
  }
  unavailableListeners.add(listener);
  return () => { unavailableListeners.delete(listener); };
}

function addRevisions(store: IDBObjectStore): void {
  const request = store.openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor === null) return;
    cursor.update({ ...cursor.value, revision: 1 });
    cursor.continue();
  };
}

function separateRunKnowledge(submissions: IDBObjectStore, knowledge: IDBObjectStore): void {
  const request = submissions.openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor === null) return;
    const { truth, ...record } = cursor.value as SubmissionRecord;
    const identity = { address: record.address, boot: record.boot, run: record.run, digest: record.digest, source: record.source };
    knowledge.add({ key: record.key, identity, revision: truth === undefined ? 0 : 1, truth: truth ?? null } satisfies RunKnowledgeRecord);
    if (truth !== undefined) cursor.update(record);
    cursor.continue();
  };
}

export function readTrajectoryDependency(transaction: IDBTransaction, pin: { versionId: string; buildId: string }, ready: (version: TrajectorySavedVersion, build: SuccessfulTrajectoryBuild) => void, fail: (error: unknown) => void): void {
  const saved: IDBRequest<SavedVersion | undefined> = transaction.objectStore("savedVersions").get(pin.versionId);
  const built: IDBRequest<BuildRecord | undefined> = transaction.objectStore("builds").get(pin.buildId);
  built.onsuccess = () => {
    try {
      const version = saved.result;
      const build = built.result;
      if (version?.kind !== "trajectory" || build?.kind !== "trajectory" || build.status !== "success" || build.versionId !== version.id) throw new Error("The pinned trajectory version or build is missing or mismatched");
      ready(version, build);
    } catch (error) { fail(error); }
  };
}

function backfillCatalog(transaction: IDBTransaction, fail: (error: unknown) => void): void {
  const heads = transaction.objectStore("resourceHeads");
  const versions = transaction.objectStore("savedVersions");
  const request = heads.openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor === null) return;
    const head = cursor.value as ResourceHead;
    const version: IDBRequest<SavedVersion | undefined> = versions.get(head.headVersionId);
    version.onsuccess = () => {
      try {
        const saved = version.result;
        if (saved === undefined || saved.kind !== head.kind || saved.resourceId !== head.id || saved.number !== head.headVersionNumber) throw new Error("The saved resource head does not match its version");
        const update = (summary: ResourceHead["summary"]): void => {
          cursor.update({ ...head, revision: head.revision ?? 1, headSavedAt: saved.savedAt, summary } satisfies ResourceHead);
          cursor.continue();
        };
        const pin = saved.kind === "scenario" ? saved.snapshot.bindings.trajectory : null;
        if (pin === null) update(resourceSummary(saved.kind, saved.snapshot));
        else readTrajectoryDependency(transaction, pin, (source, build) => update(resourceSummary(saved.kind, saved.snapshot, undefined, {
          resourceId: source.resourceId, versionId: source.id, versionNumber: source.number, digest: build.artifacts.pht.digest,
        })), fail);
      } catch (error) { fail(error); }
    };
  };
}

function normalizeSavedData(transaction: IDBTransaction, fail: (error: unknown) => void): void {
  const versions = transaction.objectStore("savedVersions");
  const buildCursor = transaction.objectStore("builds").openCursor();
  buildCursor.onsuccess = () => {
    const cursor = buildCursor.result;
    if (cursor === null) { normalizeVersions(); return; }
    const { inputFingerprint, ...record } = cursor.value as BuildRecord & { inputFingerprint: string };
    const source: IDBRequest<SavedVersion | undefined> = versions.get(record.versionId);
    source.onsuccess = () => {
      try {
        const version = source.result;
        if (version?.kind !== record.kind || inputFingerprint !== sha256(new TextEncoder().encode(canonicalContent({ versionId: version.id, kind: version.kind, contentDigest: version.contentDigest })))) throw new Error("The saved build does not match its original source fingerprint");
        if (record.kind === "scenario" && record.status === "success" && version.kind === "scenario") {
          const pin = version.snapshot.bindings.trajectory;
          if (pin === null) throw new Error("The saved scenario build has no trajectory dependency");
          readTrajectoryDependency(transaction, pin, (_source, build) => {
            const artifacts = record.artifacts as SuccessfulTrajectoryBuild["artifacts"] & typeof record.artifacts;
            if (canonicalContent({ pht: artifacts.pht, track: artifacts.track }) !== canonicalContent(build.artifacts)) throw new Error("The saved scenario build does not match its trajectory artifacts");
            cursor.update({ ...record, artifacts: { bundle: record.artifacts.bundle } });
            cursor.continue();
          }, fail);
        } else { cursor.update(record); cursor.continue(); }
      } catch (error) { fail(error); }
    };
  };
  function normalizeVersions(): void {
    const request = versions.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor === null) { backfillCatalog(transaction, fail); return; }
      try {
        const version = cursor.value as SavedVersion;
        if (savedSnapshotDigest(version.kind, version.snapshot) !== version.contentDigest) throw new Error("The saved source does not match its original digest");
        if (version.kind !== "scenario" || version.snapshot.bindings.trajectory === null) { cursor.continue(); return; }
        const pin = version.snapshot.bindings.trajectory as { versionId: string; buildId: string; trajectoryId: string; versionNumber: number; created: number; name: string; source: { text: string }; digest: string; generated: { name: string; digest: string } };
        readTrajectoryDependency(transaction, pin, (source, build) => {
          if (source.resourceId !== pin.trajectoryId || source.number !== pin.versionNumber || source.savedAt !== pin.created || source.snapshot.name !== pin.name
            || source.snapshot.source.text !== pin.source.text || sha256(new TextEncoder().encode(pin.source.text)) !== pin.digest || canonicalContent(build.artifacts.pht) !== canonicalContent(pin.generated)) throw new Error("The saved trajectory pin does not match its original dependency");
          const snapshot = { ...version.snapshot, bindings: { ...version.snapshot.bindings, trajectory: { versionId: pin.versionId, buildId: pin.buildId } } };
          cursor.update({ ...version, snapshot, contentDigest: savedSnapshotDigest("scenario", snapshot) });
          cursor.continue();
        }, fail);
      } catch (error) { fail(error); }
    };
  }
}

function backfillFileMetadata(files: IDBObjectStore, metadata: IDBObjectStore, fail: (error: unknown) => void): void {
  const request = files.openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor === null) return;
    try {
      const file = cursor.value as FileRecord;
      metadata.put({ digest: file.digest, size: file.bytes.byteLength });
      cursor.continue();
    } catch (error) { fail(error); }
  };
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open("loomsky-workbench", 5);
      let blocked = false;
      let upgradeError: unknown;
      request.onupgradeneeded = (event) => {
        try {
          const db = request.result;
          if (event.oldVersion < 1) {
            for (const [name, keyPath] of Object.entries(originalStores)) {
              const store = db.createObjectStore(name, { keyPath });
              if (name === "savedVersions") store.createIndex("resourceId", "resourceId");
              if (name === "builds") store.createIndex("versionId", "versionId");
            }
          }
          if (event.oldVersion < 2) {
            const knowledge = db.createObjectStore("runKnowledge", { keyPath: "key" });
            request.transaction!.objectStore("pending").createIndex("operationSlot", ["address", "operation.boot", "operation.sequence"]);
            const basemaps = db.createObjectStore("basemaps", { keyPath: "url" });
            try {
              const previous: unknown = JSON.parse(localStorage.getItem("loomsky.basemaps") ?? "[]");
              if (Array.isArray(previous)) for (const url of previous) if (typeof url === "string") basemaps.put({ url });
            } catch {}
            if (event.oldVersion > 0) {
              addRevisions(request.transaction!.objectStore("libraryFiles"));
              separateRunKnowledge(request.transaction!.objectStore("submissions"), knowledge);
            }
          }
          if (event.oldVersion < 3) {
            const draftHeads = db.createObjectStore("draftHeads", { keyPath: "id" });
            draftHeads.createIndex("resourceId", "resourceId");
            db.createObjectStore("draftBodies", { keyPath: "id" });
            const metadata = db.createObjectStore("fileMetadata", { keyPath: "digest" });
            const transaction = request.transaction!;
            const fail = (error: unknown): void => { upgradeError = error; transaction.abort(); };
            backfillFileMetadata(transaction.objectStore("files"), metadata, fail);
          }
          if (event.oldVersion < 5) {
            const transaction = request.transaction!;
            const fail = (error: unknown): void => { upgradeError = error; transaction.abort(); };
            if (db.objectStoreNames.contains("changes")) db.deleteObjectStore("changes");
            if (db.objectStoreNames.contains("repositoryMeta")) db.deleteObjectStore("repositoryMeta");
            normalizeSavedData(transaction, fail);
          }
        } catch (error) {
          upgradeError = error;
          request.transaction?.abort();
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) {
          db.close();
          return;
        }
        db.onversionchange = () => {
          db.close();
          unavailable = new StorageUnavailableError();
          notify(unavailableListeners, unavailable);
        };
        resolve(db);
      };
      request.onerror = () => reject(new StorageError("open", upgradeError ?? request.error));
      request.onblocked = () => {
        blocked = true;
        reject(new StorageError("open", "close other LoomSky tabs and retry"));
      };
    } catch (error) {
      reject(new StorageError("open", error));
    }
  });
}

async function connect(): Promise<IDBDatabase> {
  if (unavailable !== undefined) throw unavailable;
  if (closed) throw new StorageClosedError();
  const generation = connectionGeneration;
  database ??= open().catch((error: unknown) => {
    if (generation === connectionGeneration) database = undefined;
    throw error;
  });
  const db = await database;
  if (unavailable !== undefined) throw unavailable;
  if (closed || generation !== connectionGeneration) throw new StorageClosedError();
  return db;
}

async function transact<T>(names: StoreName[], mode: IDBTransactionMode, action: string, start: (transaction: IDBTransaction, fail: (error: unknown) => void) => () => T, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const db = await connect();
  signal?.throwIfAborted();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(names, mode);
      let failure: unknown;
      const fail = (error: unknown) => {
        failure ??= error;
        transaction.abort();
      };
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error("transaction aborted"));
      try {
        const result = start(transaction, fail);
        transaction.oncomplete = () => {
          try { resolve(result()); } catch (error) { reject(error); }
        };
      } catch (error) { fail(error); }
    });
  } catch (error) {
    if (error instanceof StorageConflictError || error instanceof StorageUnavailableError) throw error;
    throw new StorageError(action, error);
  }
}

export function readTransaction<T>(names: StoreName[], start: (transaction: IDBTransaction) => () => T): Promise<T> {
  return transact(names, "readonly", `read ${names.join(", ")} in`, start);
}

export function privateTransaction<T>(names: StoreName[], action: string, start: (transaction: IDBTransaction, fail: (error: unknown) => void) => () => T, signal?: AbortSignal): Promise<T> {
  return transact(names, "readwrite", action, start, signal);
}

export async function commitTransaction<T>(names: StoreName[], action: string, start: (transaction: IDBTransaction, fail: (error: unknown) => void, changed: (change: StorageChange) => void) => () => T, signal?: AbortSignal): Promise<T> {
  let change: StorageChange | undefined;
  const result = await privateTransaction(names, action, (transaction, fail) => start(transaction, fail, (next) => { change = next; }), signal);
  if (change !== undefined) notify(commitListeners, change);
  return result;
}

export function request<T>(name: StoreName, _mode: "readonly", make: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return readTransaction([name], (transaction) => {
    const pending = make(transaction.objectStore(name));
    return () => pending.result;
  });
}

export function all<N extends StoreName>(name: N): Promise<Stores[N][]> {
  return request(name, "readonly", (store) => store.getAll());
}

export function get<N extends StoreName>(name: N, key: string): Promise<Stores[N] | undefined> {
  return request(name, "readonly", (store) => store.get(key));
}
