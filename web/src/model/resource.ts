export type ResourceRef = { kind: "scenario"; id: string } | { kind: "trajectory"; id: string } | { kind: "file"; id: string } | { kind: "host"; key: string };

export function resourceKey(resource: ResourceRef | null): string {
  return resource === null ? "" : `${resource.kind}:${resource.kind === "host" ? resource.key : resource.id}`;
}
