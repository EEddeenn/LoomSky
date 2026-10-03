import type { ArtifactFile } from "@/model/artifact";
import type { TrajectorySource } from "@/model/trajectory";

export type ScenarioInputs = Readonly<{
  scenario: string;
  source: TrajectorySource;
  generated: ArtifactFile;
  files: Readonly<Record<string, string>>;
}>;
