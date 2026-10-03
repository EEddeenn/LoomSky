import type { ResourceRef } from "@/model/resource";
import type { LibraryFileKind } from "@/model/library";
import type { ResourceKind, SavedVersion } from "@/model/version";
import type { SavedScenarioBuild } from "@/workbench/documents/scenario/builds";
import type { SavedTrajectoryBuild } from "@/workbench/documents/trajectory/builds";
import type { VersionHistoryReader } from "@/workbench/documents/versions";
import type { PageSession } from "@/workbench/navigation";
import type { LibraryFilter, LibraryKind, LibrarySort } from "../types";

type PickerOptions = { title: string; description?: string; parent?: PageSession; onClose?(): void };
export type LibraryPickerOptions = PickerOptions & {
  kinds: readonly LibraryKind[];
  multiple?: boolean;
  selected?: readonly ResourceRef[];
  fileAccept?: string;
  fileKinds?: readonly LibraryFileKind[];
  useLabel?: string;
  onUse(resources: ResourceRef[]): boolean | void | Promise<boolean | void>;
};
type SavedBuilds = { trajectory: SavedTrajectoryBuild; scenario: SavedScenarioBuild };
type SavedVersionCandidate<K extends ResourceKind = ResourceKind> = {
  [Kind in K]: { kind: Kind; build: SavedBuilds[Kind] }
}[K];
export type SavedVersionPickerOptions = {
  [Kind in ResourceKind]: PickerOptions & {
    kind: Kind;
    selected?: { resourceId: string; versionId: string; buildId?: string };
    resourceId?: string;
    onUse: (candidate: SavedVersionCandidate<Kind>) => boolean | void | Promise<boolean | void>;
  }
}[ResourceKind];
type PickerSession = {
  id: number;
  owner: PageSession;
  query: string;
  sort: LibrarySort;
  previewOpen: boolean;
  busy: boolean;
  error: string | null;
};
type ResourcePickerSession = PickerSession & {
  mode: "resources";
  options: LibraryPickerOptions;
  filter: LibraryFilter;
  selected: ResourceRef[];
  focused: ResourceRef | null;
  scroll: number;
};
export type SavedVersionPickerSession = PickerSession & {
  mode: "versions";
  options: SavedVersionPickerOptions;
  resourceId: string | null;
  history: VersionHistoryReader | null;
  selection: SavedVersion | null;
};
export type LibraryPickerSession = ResourcePickerSession | SavedVersionPickerSession;
