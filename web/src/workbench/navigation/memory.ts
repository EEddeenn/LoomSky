import { resourceKey, type ResourceRef } from "@/model/resource";
import { captureAttention, hasAttention } from "./attention";
import { defaultCommand, defaultScenarioPreview, page, type Page } from "./state";
import { normalizeRoute, resourceOf, type Route } from "./route";

export type ResourceIdentity = string;
type ResourceMemory = Pick<Page, "route" | "instance" | "rows" | "command" | "scenarioPreview">;
export type Viewport = { top: number; left: number };
export type ViewportLease = Readonly<{ entryId: string; visitId: number; attention: number; focus: boolean; generation: number }>;

let resolveIdentity: (resource: ResourceRef) => ResourceIdentity | null = (resource) => resourceKey(resource);
let generation = 0;
const resources = new Map<string, ResourceMemory>();
const captures = new Set<() => void>();
const forgetViews = new Set<(prefix: string | null) => void>();
const viewports = createViewMemory<Viewport>();

function retain<T>(entries: Map<string, T>, key: string, value: T, limit = 128): void {
  entries.delete(key);
  entries.set(key, value);
  while (entries.size > limit) entries.delete(entries.keys().next().value!);
}

export function configureResourceIdentity(resolve: typeof resolveIdentity): void { resolveIdentity = resolve; }
export function identityOf(resource: ResourceRef): ResourceIdentity | null { return resolveIdentity(resource); }

export function instanceOf(route: Route): string | null {
  const resource = resourceOf(route);
  if (resource === null) return route.workspace;
  const identity = identityOf(resource);
  return identity === null ? null : `${resourceKey(resource)}\0${identity}`;
}

export function clearNavigationMemory(): void {
  generation++;
  captures.clear();
  resources.clear();
  for (const forget of forgetViews) forget(null);
}

export function forgetResource(resource: ResourceRef, expected?: ResourceIdentity): boolean {
  const key = resourceKey(resource);
  const live = identityOf(resource);
  const current = page.get();
  const known = resourceKey(resourceOf(current.route)) === key ? current.instance : resources.get(key)?.instance ?? null;
  if (expected !== undefined && (live !== null ? live !== expected : known !== null && known !== `${key}\0${expected}`)) return false;
  resources.delete(key);
  for (const forget of forgetViews) forget(`${key}\0`);
  return true;
}

function validInstance(state: Page): boolean {
  return state.instance !== null && state.instance === instanceOf(state.route);
}

function remembered(route: Route): ResourceMemory | undefined {
  const resource = resourceOf(route);
  if (resource === null) return undefined;
  const saved = resources.get(resourceKey(resource));
  return saved?.instance === instanceOf(route) ? saved : undefined;
}

export function resourceDestination(resource: ResourceRef): Route {
  const destination = normalizeRoute({ workspace: "resource", kind: resource.kind, id: resource.kind === "host" ? resource.key : resource.id });
  const current = page.get();
  const route = current.instance === instanceOf(destination) && resourceKey(resourceOf(current.route)) === resourceKey(resource)
    ? current.route : remembered(destination)?.route;
  if (route?.workspace !== "resource" || route.kind !== resource.kind) return destination;
  if (route.kind === "trajectory") return { workspace: "resource", kind: route.kind, id: route.id, view: route.view };
  return route;
}

export function restorePage(route: Route): Pick<Page, "instance" | "rows" | "command" | "scenarioPreview"> {
  const saved = remembered(route);
  return {
    instance: instanceOf(route),
    rows: saved?.rows ?? {},
    command: saved?.command ?? defaultCommand(),
    scenarioPreview: saved?.scenarioPreview ?? defaultScenarioPreview(),
  };
}

export function captureViewport(): ViewportLease {
  const state = page.get();
  return { entryId: state.entryId, visitId: state.visitId, attention: captureAttention().revision, focus: state.documentFocus !== null, generation };
}

function currentLease(lease: ViewportLease): boolean {
  const state = page.get();
  return lease.generation === generation && state.entryId === lease.entryId && state.visitId === lease.visitId && validInstance(state);
}

export function canRestoreViewport(lease: ViewportLease): boolean {
  return !lease.focus && currentLease(lease) && hasAttention({ visitId: lease.visitId, revision: lease.attention });
}

export function createViewMemory<T>() {
  const visits = new Map<string, { instance: string; values: Map<string, T> }>();
  const remembered = new Map<string, Map<string, T>>();
  forgetViews.add((prefix) => {
    for (const key of remembered.keys()) if (prefix === null || key.startsWith(prefix)) remembered.delete(key);
    for (const [key, visit] of visits) if (prefix === null || visit.instance.startsWith(prefix)) visits.delete(key);
  });
  const read = (lease: ViewportLease, key: string): T | undefined => {
    if (!currentLease(lease)) return undefined;
    const instance = page.get().instance!;
    const visit = visits.get(lease.entryId);
    return (visit?.instance === instance ? visit.values.get(key) : undefined) ?? remembered.get(instance)?.get(key);
  };
  const save = (lease: ViewportLease, key: string, value: T): void => {
    if (!currentLease(lease)) return;
    const instance = page.get().instance!;
    let visit = visits.get(lease.entryId);
    if (visit?.instance !== instance) visit = { instance, values: new Map() };
    retain(visit.values, key, value, 32);
    retain(visits, lease.entryId, visit);
    const values = remembered.get(instance) ?? new Map<string, T>();
    retain(values, key, value, 32);
    retain(remembered, instance, values);
  };
  const register = (lease: ViewportLease, key: string, read: () => T): (() => void) => {
    if (!currentLease(lease)) return () => {};
    const capture = () => { if (currentLease(lease)) save(lease, key, read()); };
    captures.add(capture);
    return () => { if (captures.delete(capture)) capture(); };
  };
  return { read, save, register };
}

export function readViewport(lease: ViewportLease, key: string): Viewport | null {
  return viewports.read(lease, key) ?? null;
}

export function saveViewport(lease: ViewportLease, key: string, value: Viewport): void {
  if (Number.isFinite(value.top) && Number.isFinite(value.left)) viewports.save(lease, key, { top: Math.max(0, value.top), left: Math.max(0, value.left) });
}

export function registerViewport(lease: ViewportLease, key: string, read: () => Viewport): () => void {
  return viewports.register(lease, key, read);
}

export function capturePage(): void {
  for (const capture of captures) capture();
  const state = page.get();
  if (!validInstance(state) || state.route.workspace !== "resource") return;
  const { route, instance, rows, command, scenarioPreview } = state;
  retain(resources, resourceKey(resourceOf(route)), { route, instance, rows, command, scenarioPreview });
}
