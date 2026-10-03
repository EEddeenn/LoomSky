import { randomId } from "@/core";
import { resourceKey, type ResourceRef } from "@/model/resource";
import { beginVisit, noteInteraction } from "./attention";
import { resumeBrowserPage, startBrowserHistory, writeBrowserPage } from "./history";
import { capturePage, forgetResource, identityOf, instanceOf, resourceDestination, restorePage, type ResourceIdentity } from "./memory";
import { normalizeRoute, parseRoute, resourceOf, routePath, type Destination, type DocumentView, type Route } from "./route";
import { closePageSessions } from "./sessions";
import { page, publishPage, type DocumentFocus, type DocumentTarget } from "./state";

export type NavigationOptions = { history?: "push" | "replace" };
let nextVisit = 0;
let nextFocus = 0;
type ConfirmLeave = (current: Route, next: Route, leave: () => void) => boolean;
let confirmLeave: ConfirmLeave = () => true;

function activate(route: Route, entryId: string, options: { focus?: DocumentTarget } = {}): void {
  capturePage();
  closePageSessions();
  const current = page.get();
  const visitId = ++nextVisit;
  beginVisit(visitId);
  const documentFocus: DocumentFocus | null = options.focus === undefined ? null : { ...options.focus, requestId: ++nextFocus, visitId };
  publishPage({
    ...restorePage(route),
    route, entryId, visitId, documentFocus,
    lastScenario: route.workspace === "resource" && route.kind === "scenario" ? route.id : current.lastScenario,
    ...(documentFocus === null ? {} : { activity: { ...current.activity, open: false } }),
  });
}

export function navigate(destination: Destination, options: NavigationOptions = {}): void {
  noteInteraction();
  const route = normalizeRoute(destination);
  const current = page.get();
  if (routePath(route) === routePath(current.route) && current.instance === instanceOf(route)) {
    return;
  }
  const history = options.history ?? "push";
  const entryId = history === "replace" ? current.entryId : randomId();
  const leave = () => {
    activate(route, entryId);
    writeBrowserPage(entryId, routePath(route), history);
  };
  if (confirmLeave(current.route, route, leave)) leave();
}

export function openResource(resource: ResourceRef): void {
  navigate(resourceDestination(resource));
}

export function setView(view: DocumentView, options: NavigationOptions = {}): void {
  const route = page.get().route;
  if (route.workspace === "resource" && (route.kind === "scenario" || route.kind === "trajectory")) navigate({ ...route, view }, options);
}

export function navigateToDocument(route: Route, focus: DocumentTarget): void {
  const current = page.get();
  const same = routePath(route) === routePath(current.route);
  const entryId = same ? current.entryId : randomId();
  const leave = () => {
    activate(route, entryId, { focus });
    writeBrowserPage(entryId, routePath(route), same ? "replace" : "push");
  };
  if (confirmLeave(current.route, route, leave)) leave();
}

export function resourceRemoved(resource: ResourceRef, expected?: ResourceIdentity): void {
  const live = identityOf(resource);
  if (expected !== undefined && live !== null && live !== expected) return;
  const current = page.get();
  const active = resourceKey(resourceOf(current.route)) === resourceKey(resource);
  if (!forgetResource(resource, expected)) return;
  if (active) {
    publishPage({ instance: null });
    navigate({ workspace: "library" }, { history: "replace" });
  }
}

export function refreshNavigationResource(): void {
  const current = page.get();
  const instance = instanceOf(current.route);
  if (instance === current.instance) return;
  if (current.instance === null && instance !== null) {
    publishPage({ ...restorePage(current.route), instance });
    return;
  }
  activate(current.route, current.entryId);
  writeBrowserPage(current.entryId, routePath(current.route), "replace");
}

export function startRouting(onLeave: ConfirmLeave = () => true): () => void {
  confirmLeave = onLeave;
  const stop = startBrowserHistory((entry) => {
    const route: Route = parseRoute(entry.path) ?? { workspace: "library" };
    const current = page.get();
    const samePage = entry.entryId === current.entryId && routePath(route) === routePath(current.route)
      && current.instance === instanceOf(route);
    if (!samePage) {
      if (!confirmLeave(current.route, route, () => resumeBrowserPage(entry))) return null;
      activate(route, entry.entryId);
    }
    return routePath(route);
  });
  const interact = () => noteInteraction();
  window.addEventListener("pointerdown", interact, true);
  window.addEventListener("keydown", interact, true);
  window.addEventListener("wheel", interact, { capture: true, passive: true });
  return () => {
    capturePage();
    closePageSessions();
    confirmLeave = () => true;
    stop();
    window.removeEventListener("pointerdown", interact, true);
    window.removeEventListener("keydown", interact, true);
    window.removeEventListener("wheel", interact, true);
  };
}
