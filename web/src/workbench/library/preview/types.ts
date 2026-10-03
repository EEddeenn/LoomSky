import type { ScenarioOutputs } from "@/model/scenario";
import type { Scene } from "@/workbench/preview";

export type PreviewFact = readonly [label: string, value: string];
export type PreviewIssue = { error: boolean; message: string };
export type ResourcePreview = {
  title: string;
  kind: string;
  description: string | null;
  created: number | null;
  status: { text: string; tone: "normal" | "warning" | "error" | "active" };
  facts: (PreviewFact | { kind: "scenario-outputs"; outputs: ScenarioOutputs })[];
  scene: Scene | null;
  mapCaption: string;
  mapNote: string | null;
  issues: PreviewIssue[];
  relations: { title: string; items: string[] }[];
};

export type SavedPreview = {
  version: import("@/model/version").SavedVersion;
  build: import("@/model/version").BuildRecord | null;
  trajectory: import("@/workbench/documents/trajectory/builds").SavedTrajectoryBuild | null;
  error: string | null;
};
