export type StorageChange = Readonly<
  | { scope: "resources" | "libraryFiles" | "hosts" | "submissions" | "pending" | "stops" | "basemaps"; key: string }
  | { scope: "builds"; key: string; versionId: string }
>;
