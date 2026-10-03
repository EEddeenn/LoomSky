import type { SaveState } from "@/model/document";
import type { ResourceKind, ResourceSummary } from "@/model/version";

export type StorageChange = Readonly<
  | { scope: "resources" | "libraryFiles" | "hosts" | "submissions" | "pending" | "stops" | "basemaps"; key: string }
  | { scope: "builds"; key: string; versionId: string }
>;

export type DraftHead = Readonly<{
  id: string;
  resourceId: string;
  kind: ResourceKind;
  runtimeId: string;
  baseVersionId: string;
  updatedAt: number;
  revision: number;
  summary: ResourceSummary;
  working: Readonly<{ dirty: boolean; pending: boolean; recoverable: boolean; saveState: SaveState }>;
}>;
export type StoredDraft = Readonly<{ head: DraftHead; checkpoint: unknown }>;
export type WriteDraft = Omit<DraftHead, "revision"> & Readonly<{ expectedRevision: number | null; checkpoint: unknown }>;
