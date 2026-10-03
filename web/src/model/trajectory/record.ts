export type TrajectorySource = Readonly<{ text: string }>;

export type TrajectoryRevision = Readonly<{
  versionId: string;
  buildId: string;
}>;
