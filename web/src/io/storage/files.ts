import { randomId } from "@/core";
import { compute, type TaskOptions } from "@/io/compute";
import { identifyLibraryFile, libraryFileExtension, libraryFileName, type LibraryFileRecord } from "@/model/library";
import { freezeContent } from "@/model/version";
import { all, commitTransaction, get, readTransaction, StorageConflictError, type FileRecord, type VerifiedFileRecord } from "./database";
import type { ResourceWriteOptions } from "./versions";

export class FileConflictError extends StorageConflictError {
  constructor(readonly expectedRevision: number, readonly actual: LibraryFileRecord | null) {
    super(actual === null ? "The file was removed in another tab." : "This file changed in another tab. Review its name and retry.");
    this.name = "FileConflictError";
  }
}

export async function fileBytes(digest: string): Promise<Uint8Array<ArrayBuffer> | null> {
  return (await get("files", digest))?.bytes ?? null;
}

export async function fileByteLength(digest: string): Promise<number | null> {
  return (await get("fileMetadata", digest))?.size ?? null;
}

export function fileByteLengths(digests: Iterable<string>): Promise<ReadonlyMap<string, number>> {
  const keys = [...new Set(digests)];
  return readTransaction(["fileMetadata"], (transaction) => {
    const sizes = new Map<string, number>();
    const store = transaction.objectStore("fileMetadata");
    for (const digest of keys) {
      const pending: IDBRequest<{ digest: string; size: number } | undefined> = store.get(digest);
      pending.onsuccess = () => { if (pending.result !== undefined) sizes.set(digest, pending.result.size); };
    }
    return () => sizes;
  });
}

export async function loadLibraryFiles(): Promise<LibraryFileRecord[]> {
  return (await all("libraryFiles")).map(freezeContent);
}

export async function captureFile(input: Uint8Array, options: TaskOptions = {}): Promise<VerifiedFileRecord> {
  options.signal?.throwIfAborted();
  const bytes = new Uint8Array(input);
  const digest = await compute.hash(bytes, options);
  options.signal?.throwIfAborted();
  return { digest, bytes } as VerifiedFileRecord;
}

export async function createLibraryFile(filename: string, input: Uint8Array, options: ResourceWriteOptions = {}): Promise<{ record: LibraryFileRecord; created: boolean }> {
  const name = libraryFileName(filename);
  const { digest, bytes } = await captureFile(input, options);
  const record: LibraryFileRecord = {
    id: randomId(), revision: 1, name,
    extension: libraryFileExtension(name), kind: identifyLibraryFile(name, bytes),
    size: bytes.byteLength, digest, created: Date.now(),
  };

  const committed = await commitTransaction(["files", "fileMetadata", "libraryFiles"], "import a file into", (transaction, fail, changed) => {
    options.onCommit?.();
    const store = transaction.objectStore("libraryFiles");
    const pending = store.getAll();
    let result = record;
    pending.onsuccess = () => {
      try {
        const existing = (pending.result as LibraryFileRecord[]).find((item) => item.name === name && item.digest === digest);
        if (existing === undefined) {
          transaction.objectStore("files").put({ digest, bytes } satisfies FileRecord);
          transaction.objectStore("fileMetadata").put({ digest, size: bytes.byteLength });
          store.add(record);
          changed({ scope: "libraryFiles", key: record.id });
        } else result = existing;
      } catch (error) { fail(error); }
    };
    return () => ({ record: result, created: result === record });
  }, options.signal);
  return freezeContent(committed);
}

export async function renameLibraryFileRecord(id: string, filename: string, expectedRevision: number): Promise<LibraryFileRecord> {
  const name = libraryFileName(filename);
  const committed = await commitTransaction(["libraryFiles"], "rename a file in", (transaction, fail, changed) => {
    const store = transaction.objectStore("libraryFiles");
    const pending = store.getAll();
    let result: LibraryFileRecord;
    pending.onsuccess = () => {
      try {
        const records = pending.result as LibraryFileRecord[];
        const current = records.find((record) => record.id === id);
        if (current?.revision !== expectedRevision) throw new FileConflictError(expectedRevision, current === undefined ? null : freezeContent(current));
        if (current.name === name) {
          result = current;
          return;
        }
        if (records.some((record) => record.id !== id && record.name === name && record.digest === current.digest)) throw new Error("The Library already has this file with that name");
        result = { ...current, revision: current.revision + 1, name, extension: libraryFileExtension(name) };
        store.put(result);
        changed({ scope: "libraryFiles", key: id });
      } catch (error) { fail(error); }
    };
    return () => result;
  });
  return freezeContent(committed);
}

export async function deleteLibraryFile(id: string, expectedRevision: number): Promise<void> {
  await commitTransaction(["libraryFiles"], "remove a file from", (transaction, fail, changed) => {
    const store = transaction.objectStore("libraryFiles");
    const pending: IDBRequest<LibraryFileRecord | undefined> = store.get(id);
    pending.onsuccess = () => {
      try {
        const current = pending.result;
        if (current?.revision !== expectedRevision) throw new FileConflictError(expectedRevision, current === undefined ? null : freezeContent(current));
        store.delete(id);
        changed({ scope: "libraryFiles", key: id });
      } catch (error) { fail(error); }
    };
    return () => undefined;
  });
}
