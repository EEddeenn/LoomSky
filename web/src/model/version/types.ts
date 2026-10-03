import type { PackedSummary } from "@/model/bundle";
import type { DocumentDiagnostic } from "@/model/document";
import type { ArtifactFile } from "@/model/artifact";
import type { TrajectoryRevision, TrajectorySource } from "@/model/trajectory";

export type ResourceKind = "scenario" | "trajectory";

export type ResourceSummaryTrajectory = Readonly<{ resourceId: string; versionId: string; versionNumber: number; digest: string }>;

export type ResourceSummary = Readonly<{
  name: string;
  description: string | null;
  fileDigests: readonly string[];
  trajectoryId: string | null;
  trajectoryVersionId: string | null;
  trajectoryVersionNumber: number | null;
}>;

export type ResourceHead<K extends ResourceKind = ResourceKind> = {
  [Kind in K]: Readonly<{
    id: string;
    revision: number;
    kind: Kind;
    created: number;
    headVersionId: string;
    headVersionNumber: number;
    headSavedAt: number;
    summary: ResourceSummary;
  }>
}[K];

export type ScenarioSnapshot = Readonly<{
  source: Readonly<{ text: string }>;
  bindings: Readonly<{
    files: Readonly<Record<string, string>>;
    trajectory: TrajectoryRevision | null;
  }>;
}>;

export type TrajectorySnapshot = Readonly<{
  name: string;
  source: Readonly<TrajectorySource>;
}>;

type VersionIdentity = Readonly<{
  id: string;
  resourceId: string;
  number: number;
  savedAt: number;
  parentVersionId: string | null;
  restoredFrom: string | null;
  note?: string;
  contentDigest: string;
}>;

export type ScenarioSavedVersion = VersionIdentity & Readonly<{ kind: "scenario"; snapshot: ScenarioSnapshot }>;
export type TrajectorySavedVersion = VersionIdentity & Readonly<{ kind: "trajectory"; snapshot: TrajectorySnapshot }>;
export type SavedVersion = ScenarioSavedVersion | TrajectorySavedVersion;
export type SavedVersionOf<K extends ResourceKind> = Extract<SavedVersion, { kind: K }>;
export type SavedResource<K extends ResourceKind = ResourceKind> = {
  [Kind in K]: Readonly<{ head: ResourceHead<Kind>; version: SavedVersionOf<Kind> }>
}[K];

type AppendIdentity = Readonly<{
  resourceId: string;
  create?: boolean;
  created?: number;
  restoredFrom?: string | null;
  note?: string;
}>;

export type AppendSavedVersion<K extends ResourceKind = ResourceKind> = AppendIdentity & {
  [Kind in K]: Readonly<{ kind: Kind; snapshot: SavedVersionOf<Kind>["snapshot"] }>
}[K];

export type AppendedSavedVersion<K extends ResourceKind = ResourceKind> = SavedResource<K> & Readonly<{ created: boolean }>;

type BuildIdentity = Readonly<{
  id: string;
  versionId: string;
  created: number;
  diagnostics: readonly Readonly<DocumentDiagnostic>[];
}>;

export type BuildFailureReason = "source" | "execution";

export type FailedBuild<K extends ResourceKind = ResourceKind> = BuildIdentity & Readonly<{
  kind: K;
  status: "failure";
  reason: BuildFailureReason;
  engineIdentity: string | null;
  artifacts: Readonly<{ track?: ArtifactFile }>;
}>;

type SuccessfulBuildIdentity = BuildIdentity & Readonly<{ status: "success"; engineIdentity: string }>;
export type SuccessfulTrajectoryBuild = SuccessfulBuildIdentity & Readonly<{
  kind: "trajectory";
  artifacts: Readonly<{ pht: ArtifactFile; track: ArtifactFile }>;
}>;
type SuccessfulScenarioBuild = SuccessfulBuildIdentity & Readonly<{
  kind: "scenario";
  artifacts: Readonly<{ bundle: ArtifactFile }>;
  summary: PackedSummary;
}>;
type SuccessfulBuild = SuccessfulTrajectoryBuild | SuccessfulScenarioBuild;
export type SuccessfulBuildOf<K extends ResourceKind> = Extract<SuccessfulBuild, { kind: K }>;
export type BuildRecord = FailedBuild | SuccessfulBuild;
