import type { HostRegistrationRecord, PendingSubmissionRecord, RunKnowledgeRecord, StopIntentRecord, SubmissionRecord } from "@/model/host";
import type { LibraryFileRecord } from "@/model/library";
import type { BuildRecord, ResourceHead, SavedVersion, SuccessfulTrajectoryBuild, TrajectorySavedVersion } from "@/model/version";
import type { StorageChange } from "./protocol";

export type FileRecord = { digest: string; bytes: Uint8Array<ArrayBuffer> };
declare const verifiedFile: unique symbol;
export type VerifiedFileRecord = FileRecord & { readonly [verifiedFile]: true };

type Stores = {
  resourceHeads: ResourceHead;
  savedVersions: SavedVersion;
  builds: BuildRecord;
  files: FileRecord;
  fileMetadata: { digest: string; size: number };
  libraryFiles: LibraryFileRecord;
  submissions: Omit<SubmissionRecord, "truth">;
  runKnowledge: RunKnowledgeRecord;
  pending: PendingSubmissionRecord;
  stops: StopIntentRecord;
  hosts: HostRegistrationRecord;
  basemaps: { url: string };
};
export type StoreName = keyof Stores;

const stores: Record<StoreName, string> = {
  resourceHeads: "id", savedVersions: "id", builds: "id",
  files: "digest", fileMetadata: "digest", libraryFiles: "id",
  submissions: "key", runKnowledge: "key", pending: "key", stops: "key",
  hosts: "address", basemaps: "url",
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

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open("loomsky-workbench", 5);
      let blocked = false;
      let upgradeError: unknown;
      request.onupgradeneeded = (event) => {
        try {
          const db = request.result;
          if (event.oldVersion !== 0) throw new Error("This Library uses an unsupported storage format.");
          for (const [name, keyPath] of Object.entries(stores)) {
            const store = db.createObjectStore(name, { keyPath });
            if (name === "savedVersions") store.createIndex("resourceId", "resourceId");
            if (name === "builds") store.createIndex("versionId", "versionId");
            if (name === "pending") store.createIndex("operationSlot", ["address", "operation.boot", "operation.sequence"]);
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
