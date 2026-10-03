import { extendsSubmissionTruth, sameOperation, sameSubmissionSource, type PendingSubmissionRecord, type RunKnowledgeRecord, type StopIntentRecord, type SubmissionIdentity, type SubmissionRecord, type SubmissionTruth, type SubmissionTruthPatchResult } from "@/model/host";
import { canonicalContent, type BuildRecord, type SavedVersion } from "@/model/version";
import { all, commitTransaction, get, readTransaction } from "./database";

function withKnowledge(record: Omit<SubmissionRecord, "truth">, knowledge: RunKnowledgeRecord | undefined): SubmissionRecord {
  return knowledge?.truth == null ? record : { ...record, truth: knowledge.truth };
}

export function loadSubmissions(): Promise<SubmissionRecord[]> {
  return readTransaction(["submissions", "runKnowledge"], (transaction) => {
    const records: IDBRequest<Omit<SubmissionRecord, "truth">[]> = transaction.objectStore("submissions").getAll();
    const knowledge: IDBRequest<RunKnowledgeRecord[]> = transaction.objectStore("runKnowledge").getAll();
    return () => {
      const byKey = new Map(knowledge.result.map((record) => [record.key, record]));
      return records.result.map((record) => withKnowledge(record, byKey.get(record.key)));
    };
  });
}

export function getSubmission(key: string): Promise<SubmissionRecord | undefined> {
  return readTransaction(["submissions", "runKnowledge"], (transaction) => {
    const record: IDBRequest<Omit<SubmissionRecord, "truth"> | undefined> = transaction.objectStore("submissions").get(key);
    const knowledge: IDBRequest<RunKnowledgeRecord | undefined> = transaction.objectStore("runKnowledge").get(key);
    return () => record.result === undefined ? undefined : withKnowledge(record.result, knowledge.result);
  });
}

export function getRunKnowledge(key: string): Promise<RunKnowledgeRecord | undefined> {
  return get("runKnowledge", key);
}

export function loadPending(): Promise<PendingSubmissionRecord[]> {
  return all("pending");
}

export async function deletePending(key: string): Promise<void> {
  await commitTransaction(["pending"], "delete pending submission from", (transaction, _fail, changed) => {
    transaction.objectStore("pending").delete(key);
    changed({ scope: "pending", key });
    return () => undefined;
  });
}

export function loadStops(): Promise<StopIntentRecord[]> {
  return all("stops");
}

export async function saveStop(record: StopIntentRecord): Promise<void> {
  await commitTransaction(["stops"], "save a stop intent in", (transaction, _fail, changed) => {
    transaction.objectStore("stops").put(record);
    changed({ scope: "stops", key: record.key });
    return () => undefined;
  });
}

export async function deleteStop(key: string): Promise<void> {
  await commitTransaction(["stops"], "delete a stop intent from", (transaction, _fail, changed) => {
    transaction.objectStore("stops").delete(key);
    changed({ scope: "stops", key });
    return () => undefined;
  });
}

export async function savePending(record: PendingSubmissionRecord): Promise<void> {
  await commitTransaction(["pending", "savedVersions", "builds"], "save pending submission in", (transaction, fail, changed) => {
    const store = transaction.objectStore("pending");
    const request: IDBRequest<PendingSubmissionRecord | undefined> = store.get(record.key);
    request.onsuccess = () => {
      try {
        const previous = request.result;
        if (previous !== undefined && (previous.address !== record.address || !sameOperation(previous.operation, record.operation)
          || previous.digest !== record.digest || !sameSubmissionSource(previous.source, record.source))) {
          throw new Error("A different submission already uses this operation identity");
        }
        const next = { ...(previous ?? record), target: previous?.target ?? record.target, cancelAt: previous?.cancelAt ?? record.cancelAt };
        if (previous !== undefined && previous.cancelAt === next.cancelAt && canonicalContent(previous.target) === canonicalContent(next.target)) return;
        const write = (): void => {
          store.put(next);
          changed({ scope: "pending", key: record.key });
        };
        if (previous !== undefined) write();
        else {
          const saved: IDBRequest<SavedVersion | undefined> = transaction.objectStore("savedVersions").get(record.source.versionId);
          const built: IDBRequest<BuildRecord | undefined> = transaction.objectStore("builds").get(record.source.buildId);
          const competing: IDBRequest<PendingSubmissionRecord[]> = store.index("operationSlot").getAll([record.address, record.operation.boot, record.operation.sequence]);
          competing.onsuccess = () => {
            try {
              const version = saved.result;
              const build = built.result;
              if (version?.kind !== "scenario" || version.resourceId !== record.source.scenarioId || version.number !== record.source.versionNumber
                || build?.kind !== "scenario" || build.status !== "success" || build.versionId !== version.id || build.engineIdentity !== record.source.engineIdentity) {
                throw new Error("The saved scenario or build is no longer available. Reopen the scenario before transmitting.");
              }
              if (competing.result.some((pending) => pending.key !== record.key)) throw new Error("Another tab is preparing this transmission. Review the transmitter, then retry.");
              write();
            } catch (error) { fail(error); }
          };
        }
      } catch (error) {
        fail(error);
      }
    };
    return () => undefined;
  });
}

function identityOf(record: SubmissionIdentity): SubmissionIdentity {
  return { address: record.address, boot: record.boot, run: record.run, digest: record.digest, source: record.source };
}

function sameSubmission(record: SubmissionIdentity, expected: SubmissionIdentity): boolean {
  return record.address === expected.address && record.boot === expected.boot && record.run === expected.run && record.digest === expected.digest
    && sameSubmissionSource(record.source, expected.source);
}

function compareTruth(truth: SubmissionTruth, current: SubmissionTruth | null): "applied" | "equal" | "superseded" | "sourceConflict" {
  if (current === null) return "applied";
  if (canonicalContent(current) === canonicalContent(truth)) return "equal";
  if (extendsSubmissionTruth(truth, current)) return "applied";
  return extendsSubmissionTruth(current, truth) ? "superseded" : "sourceConflict";
}

export async function saveSubmission(record: SubmissionRecord): Promise<void> {
  await commitTransaction(["submissions", "runKnowledge"], "save submission in", (transaction, fail, changed) => {
    const submissions = transaction.objectStore("submissions");
    const knowledge = transaction.objectStore("runKnowledge");
    const previous: IDBRequest<RunKnowledgeRecord | undefined> = knowledge.get(record.key);
    previous.onsuccess = () => {
      try {
        const current = previous.result;
        if (current !== undefined && !sameSubmission(current.identity, record)) throw new Error("A different submitted run already uses this identity");
        if (current === undefined) {
          const { truth, ...payload } = record;
          submissions.add(payload);
          knowledge.add({ key: record.key, identity: identityOf(record), revision: truth === undefined ? 0 : 1, truth: truth ?? null } satisfies RunKnowledgeRecord);
        } else {
          if (record.truth === undefined) return;
          const outcome = compareTruth(record.truth, current.truth);
          if (outcome === "sourceConflict") throw new Error("The submitted run has incompatible observed output");
          if (outcome !== "applied") return;
          knowledge.put({ ...current, revision: current.revision + 1, truth: record.truth } satisfies RunKnowledgeRecord);
        }
        changed({ scope: "submissions", key: record.key });
      } catch (error) { fail(error); }
    };
    return () => undefined;
  });
}

export async function patchSubmissionTruth(key: string, expected: SubmissionIdentity, truth: SubmissionTruth): Promise<SubmissionTruthPatchResult> {
  const captured = structuredClone({ expected: identityOf(expected), truth });
  return commitTransaction(["runKnowledge"], "update run knowledge in", (transaction, fail, changed) => {
    const store = transaction.objectStore("runKnowledge");
    const previous: IDBRequest<RunKnowledgeRecord | undefined> = store.get(key);
    let result: SubmissionTruthPatchResult = { kind: "missing" };
    previous.onsuccess = () => {
      try {
        const current = previous.result;
        if (current === undefined) return;
        if (!sameSubmission(current.identity, captured.expected)) {
          result = { kind: "sourceConflict" };
          return;
        }
        const kind = compareTruth(captured.truth, current.truth);
        if (kind === "sourceConflict") {
          result = { kind };
          return;
        }
        if (kind === "applied") {
          const next = { ...current, revision: current.revision + 1, truth: captured.truth };
          store.put(next);
          changed({ scope: "submissions", key: key });
          result = { kind, truth: next.truth, revision: next.revision };
        } else result = { kind, truth: current.truth!, revision: current.revision };
      } catch (error) { fail(error); }
    };
    return () => result;
  });
}
