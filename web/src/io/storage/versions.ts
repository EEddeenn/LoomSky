import { randomId } from "@/core";
import type { TaskOptions } from "@/io/compute";
import type { PendingSubmissionRecord, SubmissionRecord } from "@/model/host";
import { canonicalContent, freezeContent, immutableCopy, resourceSummary, savedSnapshotDigest, savedVersionName, type AppendSavedVersion, type AppendedSavedVersion, type BuildRecord, type ResourceHead, type ResourceKind, type ResourceSummaryTrajectory, type SavedResource, type SavedVersion } from "@/model/version";
import { all, commitTransaction, get, readTrajectoryDependency, request, type FileRecord, type VerifiedFileRecord } from "./database";

export type ResourceWriteOptions = TaskOptions & { onCommit?: () => void };

export async function getResourceHead(id: string): Promise<ResourceHead | undefined> {
  const record = await get("resourceHeads", id);
  return record === undefined ? undefined : freezeContent(record);
}

export async function loadResourceHeads(kind?: ResourceKind): Promise<ResourceHead[]> {
  return (await all("resourceHeads"))
    .filter((head) => kind === undefined || head.kind === kind)
    .map(freezeContent);
}

export function savedResource(head: ResourceHead, version: SavedVersion | undefined): SavedResource {
  if (version !== undefined && version.resourceId === head.id && version.id === head.headVersionId && version.number === head.headVersionNumber) {
    if (head.kind === "scenario" && version.kind === "scenario") return freezeContent({ head, version });
    if (head.kind === "trajectory" && version.kind === "trajectory") return freezeContent({ head, version });
  }
  throw new Error("The saved resource head does not match its version");
}

export async function getSavedVersion(id: string): Promise<SavedVersion | undefined> {
  const version = await get("savedVersions", id);
  return version === undefined ? undefined : freezeContent(version);
}

export async function loadSavedVersions(resourceId: string): Promise<SavedVersion[]> {
  const versions: SavedVersion[] = await request("savedVersions", "readonly", (store) => store.index("resourceId").getAll(resourceId));
  return versions.toSorted((left, right) => right.number - left.number).map(freezeContent);
}

function captureBytes(input: readonly VerifiedFileRecord[]): FileRecord[] {
  return input.map((file) => ({ digest: file.digest, bytes: new Uint8Array(file.bytes) }));
}

function keepTransactionBytes(transaction: IDBTransaction, bytes: readonly FileRecord[]): void {
  const files = transaction.objectStore("files");
  const metadata = transaction.objectStore("fileMetadata");
  for (const file of bytes) {
    files.put(file);
    metadata.put({ digest: file.digest, size: file.bytes.byteLength });
  }
}

function requireTransactionBytes(transaction: IDBTransaction, digests: Iterable<string>, fail: (error: unknown) => void): void {
  for (const digest of new Set(digests)) {
    const pending = transaction.objectStore("files").getKey(digest);
    pending.onsuccess = () => {
      if (pending.result === undefined) fail(new Error(`The referenced file ${digest} is missing from browser storage`));
    };
  }
}

function requireSnapshotReferences(transaction: IDBTransaction, input: AppendSavedVersion, fail: (error: unknown) => void, ready: (trajectory?: ResourceSummaryTrajectory) => void): void {
  if (input.restoredFrom != null) {
    const restored: IDBRequest<SavedVersion | undefined> = transaction.objectStore("savedVersions").get(input.restoredFrom);
    restored.onsuccess = () => {
      if (restored.result?.resourceId !== input.resourceId || restored.result.kind !== input.kind) fail(new Error("The restored version does not belong to this resource"));
    };
  }
  if (input.kind !== "scenario") { ready(); return; }
  const trajectory = input.snapshot.bindings.trajectory;
  requireTransactionBytes(transaction, Object.values(input.snapshot.bindings.files), fail);
  if (trajectory === null) { ready(); return; }
  readTrajectoryDependency(transaction, trajectory, (version, build) => {
    requireTransactionBytes(transaction, Object.values(build.artifacts).map((artifact) => artifact.digest), fail);
    ready({ resourceId: version.resourceId, versionId: version.id, versionNumber: version.number, digest: build.artifacts.pht.digest });
  }, fail);
}

export function appendSavedVersion(input: AppendSavedVersion<"scenario">, bytes?: readonly VerifiedFileRecord[], options?: ResourceWriteOptions): Promise<AppendedSavedVersion<"scenario">>;
export function appendSavedVersion(input: AppendSavedVersion<"trajectory">, bytes?: readonly VerifiedFileRecord[], options?: ResourceWriteOptions): Promise<AppendedSavedVersion<"trajectory">>;
export function appendSavedVersion(input: AppendSavedVersion, bytes?: readonly VerifiedFileRecord[], options?: ResourceWriteOptions): Promise<AppendedSavedVersion>;
export async function appendSavedVersion(input: AppendSavedVersion, bytes: readonly VerifiedFileRecord[] = [], options: ResourceWriteOptions = {}): Promise<AppendedSavedVersion> {
  options.signal?.throwIfAborted();
  const captured = immutableCopy(input);
  const capturedBytes = captureBytes(bytes);
  const contentDigest = savedSnapshotDigest(captured.kind, captured.snapshot);
  const committed = await commitTransaction(["resourceHeads", "savedVersions", "builds", "files", "fileMetadata"], "save a version in", (transaction, fail, changed) => {
    options.onCommit?.();
    const heads = transaction.objectStore("resourceHeads");
    const versions = transaction.objectStore("savedVersions");
    const pending: IDBRequest<ResourceHead | undefined> = heads.get(captured.resourceId);
    let result: AppendedSavedVersion;
    pending.onsuccess = () => {
      try {
        const previousHead = pending.result;
        const actual = previousHead?.headVersionId ?? null;
        if (captured.create ? previousHead !== undefined : previousHead === undefined) {
          throw new Error(captured.create ? "A resource with this identity already exists." : "This resource was deleted. Save a new copy to keep your work.");
        }
        if (previousHead !== undefined && previousHead.kind !== captured.kind) throw new Error("The saved resource has a different type");
        const append = (previous: SavedResource | undefined): void => {
          try {
            keepTransactionBytes(transaction, capturedBytes);
            requireSnapshotReferences(transaction, captured, fail, (trajectory) => {
              const savedAt = Date.now();
              const identity = {
                id: randomId(), resourceId: captured.resourceId,
                number: (previous?.head.headVersionNumber ?? 0) + 1,
                savedAt, parentVersionId: actual, restoredFrom: captured.restoredFrom ?? null,
                ...(captured.note === undefined ? {} : { note: captured.note }), contentDigest,
              };
              const head = {
                id: captured.resourceId, revision: (previousHead?.revision ?? 0) + 1, created: previous?.head.created ?? captured.created ?? savedAt,
                headVersionId: identity.id, headVersionNumber: identity.number, headSavedAt: savedAt,
                summary: resourceSummary(captured.kind, captured.snapshot, undefined, trajectory),
              };
              const resource: SavedResource = captured.kind === "scenario"
                ? { head: { ...head, kind: "scenario" }, version: { ...identity, kind: "scenario", snapshot: captured.snapshot } }
                : { head: { ...head, kind: "trajectory" }, version: { ...identity, kind: "trajectory", snapshot: captured.snapshot } };
              versions.add(resource.version);
              heads.put(resource.head);
              changed({ scope: "resources", key: resource.head.id });
              result = freezeContent({ ...resource, created: true });
            });
          } catch (error) {
            fail(error);
          }
        };
        if (previousHead === undefined) append(undefined);
        else {
          const current: IDBRequest<SavedVersion | undefined> = versions.get(previousHead.headVersionId);
          current.onsuccess = () => {
            try {
              if (current.result === undefined) throw new Error("The current saved version is missing");
              append(savedResource(previousHead, current.result));
            } catch (error) {
              fail(error);
            }
          };
        }
      } catch (error) {
        fail(error);
      }
    };
    return () => result;
  }, options.signal);
  return freezeContent(committed);
}

export async function deleteResource(id: string): Promise<void> {
  await commitTransaction(["resourceHeads", "savedVersions", "builds", "submissions", "pending"], "delete a resource from", (transaction, fail, changed) => {
    const heads = transaction.objectStore("resourceHeads");
    const versions = transaction.objectStore("savedVersions");
    const builds = transaction.objectStore("builds");
    const head: IDBRequest<ResourceHead | undefined> = heads.get(id);
    const saved: IDBRequest<SavedVersion[]> = versions.getAll();
    const built: IDBRequest<BuildRecord[]> = builds.getAll();
    built.onsuccess = () => {
      try {
        const current = head.result;
        if (current === undefined) return;
        const versionIds = new Set(saved.result.filter((version) => version.resourceId === id).map((version) => version.id));
        const buildIds = new Set(built.result.filter((build) => versionIds.has(build.versionId)).map((build) => build.id));
        if (current.kind === "trajectory") {
          const dependent = saved.result.find((version) => version.kind === "scenario" && version.snapshot.bindings.trajectory !== null
            && (versionIds.has(version.snapshot.bindings.trajectory.versionId) || buildIds.has(version.snapshot.bindings.trajectory.buildId)));
          if (dependent !== undefined) throw new Error(`Cannot delete this trajectory: scenario “${savedVersionName(dependent)}” v${dependent.number} uses it.`);
        } else {
          for (const name of ["submissions", "pending"] as const) {
            const request = transaction.objectStore(name).openCursor();
            request.onsuccess = () => {
              try {
                const cursor = request.result;
                if (cursor === null) return;
                const record = cursor.value as SubmissionRecord | PendingSubmissionRecord;
                if (record.source.scenarioId === id || versionIds.has(record.source.versionId) || buildIds.has(record.source.buildId)) {
                  const usage = "run" in record ? `run ${record.run} on ${record.address}` : `a pending transmission on ${record.address}`;
                  throw new Error(`Cannot delete this scenario: ${usage} uses its saved version.`);
                }
                cursor.continue();
              } catch (error) { fail(error); }
            };
          }
        }
        heads.delete(id);
        for (const versionId of versionIds) versions.delete(versionId);
        for (const buildId of buildIds) builds.delete(buildId);
        changed({ scope: "resources", key: id });
      } catch (error) { fail(error); }
    };
    return () => undefined;
  });
}

export async function getBuildRecord(id: string): Promise<BuildRecord | undefined> {
  const build = await get("builds", id);
  return build === undefined ? undefined : freezeContent(build);
}

export async function loadBuildRecords(versionId?: string): Promise<BuildRecord[]> {
  const builds: BuildRecord[] = versionId === undefined ? await all("builds")
    : await request("builds", "readonly", (store) => store.index("versionId").getAll(versionId));
  return builds.toSorted((left, right) => right.created - left.created).map(freezeContent);
}

export async function saveBuildRecord(input: BuildRecord, bytes: readonly VerifiedFileRecord[] = [], options: TaskOptions = {}): Promise<void> {
  options.signal?.throwIfAborted();
  const record = immutableCopy(input);
  const capturedBytes = captureBytes(bytes);
  await commitTransaction(["savedVersions", "builds", "files", "fileMetadata"], "save a build in", (transaction, fail, changed) => {
    keepTransactionBytes(transaction, capturedBytes);
    requireTransactionBytes(transaction, Object.values(record.artifacts).filter((artifact) => artifact !== undefined).map((artifact) => artifact.digest), fail);
    const source: IDBRequest<SavedVersion | undefined> = transaction.objectStore("savedVersions").get(record.versionId);
    source.onsuccess = () => {
      const version = source.result;
      if (version?.kind !== record.kind) fail(new Error("The build's saved source version is missing or has a different type"));
      else if (record.status === "success" && version.kind === "scenario" && version.snapshot.bindings.trajectory === null) fail(new Error("The scenario build has no pinned trajectory"));
    };
    const store = transaction.objectStore("builds");
    const pending: IDBRequest<BuildRecord | undefined> = store.get(record.id);
    pending.onsuccess = () => {
      try {
        if (pending.result === undefined) {
          store.add(record);
          changed({ scope: "builds", key: record.id, versionId: record.versionId });
        }
        else if (canonicalContent(pending.result) !== canonicalContent(record)) throw new Error("A different immutable build already uses this identity");
      } catch (error) { fail(error); }
    };
    return () => undefined;
  }, options.signal);
}
