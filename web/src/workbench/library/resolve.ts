import type { ResourceRef } from "@/model/resource";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import type { TrajectoryDoc } from "@/workbench/documents/trajectory";
import { hosts, type Host } from "@/workbench/hosts";
import type { LibraryFileRecord } from "@/model/library";
import { fileLibrary } from "@/workbench/files";


export type ResolvedLibraryResource =
  | { kind: "scenario"; doc: ScenarioDoc }
  | { kind: "trajectory"; doc: TrajectoryDoc }
  | { kind: "host"; host: Host }
  | { kind: "file"; file: LibraryFileRecord };

type UnavailableResource = { status: "loading" } | { status: "error"; message: string } | { status: "missing" };
export type LibraryResolution = { status: "ready"; value: ResolvedLibraryResource } | UnavailableResource;

function unavailable(loaded: boolean, error: string | null): UnavailableResource {
  return error !== null ? { status: "error", message: error } : { status: loaded ? "missing" : "loading" };
}

export function resolveLibraryResource(resource: Extract<ResourceRef, { kind: "file" | "host" }>): LibraryResolution {
  if (resource.kind === "host") {
    const state = hosts.get();
    const host = state.list.find((item) => item.key === resource.key);
    return host === undefined ? unavailable(state.loaded, state.loadError) : { status: "ready", value: { kind: "host", host } };
  }
  const state = fileLibrary.get();
  const file = state.items.get(resource.id);
  return file === undefined ? unavailable(state.loaded, state.error) : { status: "ready", value: { kind: "file", file } };
}
