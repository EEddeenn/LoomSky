import { createStore } from "@/core";
import { resourceKey, type ResourceRef } from "@/model/resource";
import { buildScenarioVersion, loadScenarioBuild } from "@/workbench/documents/scenario/builds";
import { buildTrajectoryVersion, loadTrajectoryBuild } from "@/workbench/documents/trajectory/builds";
import { closePageSession, createPageSession, isPageSession, noteInteraction } from "@/workbench/navigation";
import { createVersionHistoryReader } from "@/workbench/documents/versions";
import { libraryFileOf } from "@/workbench/files";
import type { LibraryFilter, LibrarySort } from "../types";
import type { LibraryPickerOptions, LibraryPickerSession, SavedVersionPickerOptions, SavedVersionPickerSession } from "./types";

export const libraryPicker = createStore<{ session: LibraryPickerSession | null }>({ session: null });
let preparation: AbortController | null = null;

export function acceptsLibraryResource(resource: ResourceRef, options: LibraryPickerOptions | null): boolean {
  if (options === null) return true;
  if (!options.kinds.includes(resource.kind)) return false;
  if (resource.kind !== "file" || options.fileKinds === undefined) return true;
  const file = libraryFileOf(resource.id);
  return file !== undefined && (file.kind === "other" || options.fileKinds.includes(file.kind));
}

function disposeSession(id: number): void {
  const session = libraryPicker.get().session;
  if (session?.id !== id) return;
  preparation?.abort();
  preparation = null;
  if (session.mode === "versions") session.history?.dispose();
  libraryPicker.set({ session: null });
  session.options.onClose?.();
}

function activeVersions(id: number): SavedVersionPickerSession | null {
  const session = libraryPicker.get().session;
  return session?.id === id && session.mode === "versions" ? session : null;
}

function beginSession(options: LibraryPickerOptions | SavedVersionPickerOptions) {
  if (libraryPicker.get().session?.busy || options.parent !== undefined && !isPageSession(options.parent)) {
    options.onClose?.();
    return null;
  }
  const previous = libraryPicker.get().session;
  if (previous !== null) closePageSession(previous.owner);
  if (options.parent !== undefined && !isPageSession(options.parent)) {
    options.onClose?.();
    return null;
  }
  const owner = createPageSession({ parent: options.parent, onClose: () => disposeSession(owner.id) });
  noteInteraction();
  return { id: owner.id, owner, query: "", sort: "name" as const, previewOpen: true, busy: false, error: null };
}

export function openLibraryPicker(options: LibraryPickerOptions): void {
  const session = beginSession(options);
  if (session === null) return;
  const candidates = (options.selected ?? []).filter((resource) => acceptsLibraryResource(resource, options));
  const unique = [...new Map(candidates.map((resource) => [resourceKey(resource), resource])).values()];
  const selected = options.multiple ? unique : unique.slice(0, 1);
  libraryPicker.set({ session: {
    ...session, mode: "resources", options,
    filter: options.kinds.length === 1 ? options.kinds[0] ?? "all" : "all",
    selected, focused: selected.at(-1) ?? null, scroll: 0,
  } });
}

export function openSavedVersionPicker(options: SavedVersionPickerOptions): void {
  const session = beginSession(options);
  if (session === null) return;
  libraryPicker.set({ session: {
    ...session, mode: "versions",
    options: { ...options },
    resourceId: null, history: null, selection: null,
  } });
  const resourceId = options.selected?.resourceId ?? options.resourceId;
  if (resourceId !== undefined) void selectLibraryResource({ kind: options.kind, id: resourceId });
}

export function closeLibraryPicker(): void {
  const session = libraryPicker.get().session;
  if (session === null || session.busy) return;
  closePageSession(session.owner);
}

export function setLibraryPicker(patch: { query?: string; sort?: LibrarySort; previewOpen?: boolean; filter?: LibraryFilter; scroll?: number }): void {
  const session = libraryPicker.get().session;
  if (session === null || session.busy) return;
  if (Object.keys(patch).some((key) => key !== "scroll")) noteInteraction();
  if (session.mode === "resources") libraryPicker.set({ session: { ...session, ...patch } });
  else {
    const { query = session.query, sort = session.sort, previewOpen = session.previewOpen } = patch;
    libraryPicker.set({ session: { ...session, query, sort, previewOpen } });
  }
}

export function focusLibraryResource(resource: ResourceRef): void {
  const session = libraryPicker.get().session;
  if (session?.mode !== "resources" || session.busy) return;
  noteInteraction();
  libraryPicker.set({ session: { ...session, focused: resource } });
}

export function clearLibrarySelection(): void {
  const session = libraryPicker.get().session;
  if (session?.mode !== "resources" || session.busy) return;
  noteInteraction();
  libraryPicker.set({ session: { ...session, selected: [], focused: null, error: null } });
}

export async function selectLibraryResource(resource: ResourceRef): Promise<void> {
  const session = libraryPicker.get().session;
  if (session === null || session.busy) return;
  noteInteraction();
  if (session.mode === "resources") {
    if (!acceptsLibraryResource(resource, session.options)) return;
    const key = resourceKey(resource);
    const selected = session.options.multiple
      ? session.selected.some((item) => resourceKey(item) === key) ? session.selected.filter((item) => resourceKey(item) !== key) : [...session.selected, resource]
      : [resource];
    libraryPicker.set({ session: { ...session, selected, focused: resource, error: null } });
    return;
  }
  if (resource.kind !== session.options.kind || resource.id === session.resourceId) return;
  session.history?.dispose();
  const history = createVersionHistoryReader(resource.id);
  libraryPicker.set({ session: { ...session, resourceId: resource.id, history, selection: null, error: null } });
  await refreshLibraryVersions();
}

export async function refreshLibraryVersions(): Promise<void> {
  const session = libraryPicker.get().session;
  if (session?.mode !== "versions" || session.history === null) return;
  const history = session.history;
  const data = await history.load();
  const current = activeVersions(session.id);
  if (data === null || current?.history !== history || current.selection !== null) return;
  const initial = current.options.selected;
  const version = initial?.resourceId === current.resourceId
    ? data.versions.find((item) => item.id === initial.versionId) : data.versions[0];
  libraryPicker.set({ session: { ...current, selection: version ?? null,
    error: version === undefined && initial?.resourceId === current.resourceId ? "Selected version is no longer available." : null,
  } });
}

export function selectSavedVersion(versionId: string): void {
  const session = libraryPicker.get().session;
  if (session?.mode !== "versions" || session.busy) return;
  const version = session.history?.state.get().data?.versions.find((item) => item.id === versionId);
  if (version === undefined || version.kind !== session.options.kind || version.resourceId !== session.resourceId) return;
  noteInteraction();
  libraryPicker.set({ session: { ...session, selection: version, error: null } });
}

export async function acceptLibraryImports(requestId: number, resources: readonly ResourceRef[]): Promise<void> {
  const session = libraryPicker.get().session;
  if (session?.id !== requestId || session.busy) return;
  const accepted = resources.filter((resource) => session.mode === "resources" ? acceptsLibraryResource(resource, session.options) : resource.kind === session.options.kind);
  const focused = accepted[0];
  if (focused === undefined) {
    libraryPicker.set({ session: { ...session, error: "Files added to Library. Their types do not match this field." } });
    return;
  }
  noteInteraction();
  if (session.mode === "resources") {
    const selected = session.options.multiple ? [...new Map([...session.selected, ...accepted].map((resource) => [resourceKey(resource), resource])).values()] : [focused];
    libraryPicker.set({ session: { ...session, selected, focused, query: "", scroll: 0, error: null } });
  } else {
    libraryPicker.set({ session: { ...session, query: "", error: null } });
    await selectLibraryResource(focused);
  }
}

export async function useLibrarySelection(): Promise<void> {
  const session = libraryPicker.get().session;
  if (session === null || session.busy) return;
  if (session.mode === "resources" && session.selected.length === 0) return;
  if (session.mode === "versions" && session.selection === null) return;
  noteInteraction();
  libraryPicker.set({ session: { ...session, busy: true, error: null } });
  try {
    const result = session.mode === "resources" ? await session.options.onUse([...session.selected]) : await useSavedVersion(session);
    const current = libraryPicker.get().session;
    if (current?.id !== session.id) return;
    libraryPicker.set({ session: { ...current, busy: false, error: result === false ? "Could not apply selection. Review the problem and retry." : null } });
    if (result !== false) closeLibraryPicker();
  } catch (error) {
    const current = libraryPicker.get().session;
    if (current?.id === session.id) libraryPicker.set({ session: { ...current, busy: false, error: error instanceof Error ? error.message : String(error) } });
  }
}

async function useSavedVersion(session: SavedVersionPickerSession): Promise<boolean | void> {
  const { options, selection: version } = session;
  if (version === null) return false;
  const controller = new AbortController();
  preparation = controller;
  const buildId = options.selected?.versionId === version.id ? options.selected.buildId : undefined;
  try {
    if (options.kind === "trajectory") {
      const build = buildId === undefined ? await buildTrajectoryVersion(version.id, { signal: controller.signal }) : await loadTrajectoryBuild(buildId, { signal: controller.signal });
      controller.signal.throwIfAborted();
      if (build.version.id !== version.id || build.version.resourceId !== version.resourceId) throw new Error("Generated trajectory does not match this version.");
      return await options.onUse({ kind: "trajectory", build });
    }
    const build = buildId === undefined ? await buildScenarioVersion(version.id, { signal: controller.signal }) : await loadScenarioBuild(buildId, { signal: controller.signal });
    controller.signal.throwIfAborted();
    if (build.versionId !== version.id || build.resourceId !== version.resourceId) throw new Error("Generated scenario does not match this version.");
    return await options.onUse({ kind: "scenario", build });
  } finally {
    if (preparation === controller) preparation = null;
  }
}
