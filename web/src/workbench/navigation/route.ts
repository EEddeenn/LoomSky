import type { DocumentDiagnostic } from "@/model/document";
import type { ResourceRef } from "@/model/resource";

const scenarioTabs = ["setup", "signals", "navigation", "messages", "outputs"] as const;
const hostTabs = ["run", "preview", "history", "device"] as const;
export type ScenarioTab = typeof scenarioTabs[number];
export type HostTab = typeof hostTabs[number];
export type DocumentView = "form" | "json";
export type ResourceRoute =
  | { workspace: "resource"; kind: "scenario"; id: string; tab: ScenarioTab; view: DocumentView }
  | { workspace: "resource"; kind: "trajectory"; id: string; view: DocumentView; returnScenario?: string }
  | { workspace: "resource"; kind: "host"; id: string; tab: HostTab }
  | { workspace: "resource"; kind: "file"; id: string };
export type Route = { workspace: "home" } | { workspace: "library" } | ResourceRoute;
export type Destination =
  | { workspace: "home" }
  | { workspace: "library" }
  | { workspace: "resource"; kind: "scenario"; id: string; tab?: ScenarioTab; view?: DocumentView }
  | { workspace: "resource"; kind: "trajectory"; id: string; view?: DocumentView; returnScenario?: string }
  | { workspace: "resource"; kind: "host"; id: string; tab?: HostTab }
  | { workspace: "resource"; kind: "file"; id: string };

export function normalizeRoute(destination: Destination): Route {
  if (destination.workspace !== "resource") return { workspace: destination.workspace };
  const { kind, id } = destination;
  if (kind === "scenario") return { workspace: "resource", kind, id, tab: destination.tab ?? "setup", view: destination.view ?? "form" };
  if (kind === "host") return { workspace: "resource", kind, id, tab: destination.tab ?? "run" };
  if (kind === "trajectory") return { workspace: "resource", kind, id, view: destination.view ?? "form", ...(destination.returnScenario === undefined ? {} : { returnScenario: destination.returnScenario }) };
  return { workspace: "resource", kind, id };
}

export function parseRoute(address: string): Route | null {
  try {
    const [path = "", query = ""] = address.split("?");
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) return { workspace: "home" };
    const [workspace, kind, encoded, tab] = parts;
    if (workspace === "library" && parts.length === 1) return { workspace: "library" };
    if (workspace !== "resource" || encoded === undefined) return null;
    const id = decodeURIComponent(encoded);
    if (id === "") return null;
    const parameters = new URLSearchParams(query);
    const view = parameters.get("view") === "json" ? "json" : "form";
    if (kind === "trajectory" && parts.length === 3) {
      const back = parameters.get("scenario");
      return normalizeRoute({ workspace, kind, id, view, ...(back === null || back === "" ? {} : { returnScenario: back }) });
    }
    if (kind === "host" && parts.length <= 4) return normalizeRoute({ workspace, kind, id, tab: hostTabs.find((candidate) => candidate === tab) });
    if (kind === "scenario" && parts.length <= 4) return normalizeRoute({ workspace, kind, id, tab: scenarioTabs.find((candidate) => candidate === tab), view });
    if (kind === "file" && parts.length === 3) return { workspace, kind, id };
  } catch { return null; }
  return null;
}

export function routePath(destination: Destination): string {
  const route = normalizeRoute(destination);
  if (route.workspace === "home") return "/";
  if (route.workspace === "library") return "/library";
  let path = `/resource/${route.kind}/${encodeURIComponent(route.id)}`;
  if (route.kind === "host" || route.kind === "scenario") path += `/${route.tab}`;
  const parameters: string[] = [];
  if (route.kind === "trajectory" && route.returnScenario !== undefined) parameters.push(`scenario=${encodeURIComponent(route.returnScenario)}`);
  if ((route.kind === "scenario" || route.kind === "trajectory") && route.view === "json") parameters.push("view=json");
  return `${path}${parameters.length === 0 ? "" : `?${parameters.join("&")}`}`;
}

export function resourceOf(route: Route): ResourceRef | null {
  if (route.workspace !== "resource") return null;
  return route.kind === "host" ? { kind: "host", key: route.id } : { kind: route.kind, id: route.id };
}

export function documentView(route: Route): DocumentView {
  return route.workspace === "resource" && (route.kind === "scenario" || route.kind === "trajectory") ? route.view : "form";
}

const scenarioHomes: readonly (readonly [ScenarioTab, readonly string[]])[] = [
  ["setup", ["name", "description", "time", "duration", "trajectory"]],
  ["signals", ["signals", "samples", "elevationMask", "maskOut", "power"]],
  ["navigation", ["ephemeris", "almanac", "antenna", "precise", "ionosphere"]],
  ["outputs", ["observation", "position"]],
];

export function sectionOf(diagnostic: Pick<DocumentDiagnostic, "path">): ScenarioTab {
  const top = diagnostic.path.split(/[.[]/)[0] ?? "";
  return scenarioHomes.find(([, keys]) => keys.includes(top))?.[0] ?? "messages";
}
