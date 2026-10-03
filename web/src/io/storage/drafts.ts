import { privateTransaction, readTransaction, StorageConflictError } from "./database";
import type { DraftHead, StoredDraft, WriteDraft } from "./protocol";

export class DraftConflictError extends StorageConflictError {
  constructor(readonly expectedRevision: number | null, readonly actual: DraftHead | null) {
    super("This draft changed or belongs to another editor. Reload to continue.");
    this.name = "DraftConflictError";
  }
}

export async function writeDraft(input: WriteDraft): Promise<DraftHead> {
  const captured = structuredClone(input);
  return privateTransaction(["draftHeads", "draftBodies"], "save a draft in", (transaction, fail) => {
    const heads = transaction.objectStore("draftHeads");
    const pending: IDBRequest<DraftHead | undefined> = heads.get(captured.id);
    let result: DraftHead;
    pending.onsuccess = () => {
      try {
        const current = pending.result;
        if ((current?.revision ?? null) !== captured.expectedRevision
          || current !== undefined && (current.runtimeId !== captured.runtimeId || current.resourceId !== captured.resourceId || current.kind !== captured.kind)) {
          throw new DraftConflictError(captured.expectedRevision, current ?? null);
        }
        const { expectedRevision: _expectedRevision, checkpoint, ...head } = captured;
        result = { ...head, revision: (current?.revision ?? 0) + 1 };
        heads.put(result);
        transaction.objectStore("draftBodies").put({ id: captured.id, checkpoint });
      } catch (error) {
        fail(error);
      }
    };
    return () => result;
  });
}

export function readDraft(id: string): Promise<StoredDraft | undefined> {
  return readTransaction(["draftHeads", "draftBodies"], (transaction) => {
    const head: IDBRequest<DraftHead | undefined> = transaction.objectStore("draftHeads").get(id);
    const body: IDBRequest<{ id: string; checkpoint: unknown } | undefined> = transaction.objectStore("draftBodies").get(id);
    return () => {
      if (head.result === undefined) return undefined;
      if (body.result === undefined) throw new Error("The draft checkpoint is missing from browser storage.");
      return { head: head.result, checkpoint: body.result.checkpoint };
    };
  });
}

export function loadDraftHeads(resourceId?: string): Promise<DraftHead[]> {
  return readTransaction(["draftHeads"], (transaction) => {
    const store = transaction.objectStore("draftHeads");
    const pending: IDBRequest<DraftHead[]> = resourceId === undefined ? store.getAll() : store.index("resourceId").getAll(resourceId);
    return () => pending.result.toSorted((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
  });
}

export function deleteDraft(id: string, expectedRevision: number): Promise<boolean> {
  return privateTransaction(["draftHeads", "draftBodies"], "delete a draft from", (transaction, fail) => {
    const heads = transaction.objectStore("draftHeads");
    const pending: IDBRequest<DraftHead | undefined> = heads.get(id);
    let removed = false;
    pending.onsuccess = () => {
      try {
        const current = pending.result;
        if (current === undefined) return;
        if (current.revision !== expectedRevision) throw new DraftConflictError(expectedRevision, current);
        heads.delete(id);
        transaction.objectStore("draftBodies").delete(id);
        removed = true;
      } catch (error) {
        fail(error);
      }
    };
    return () => removed;
  });
}
