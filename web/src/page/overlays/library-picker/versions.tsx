"use client";

import { useRef, useSyncExternalStore } from "react";
import { duration, fixed, trimmed, useStore } from "@/core";
import type { ResourceRef } from "@/model/resource";
import { gpsClock, gpsDate } from "@/model/gnss";
import { reloadScenarioCatalog, scenarioCatalog } from "@/workbench/documents/scenario";
import { reloadTrajectoryCatalog, trajectoryCatalog } from "@/workbench/documents/trajectory";
import { closeLibraryPicker, libraryPicker, refreshLibraryVersions, selectLibraryResource, selectSavedVersion, setLibraryPicker, useLibrarySelection, type SavedVersionCandidate } from "@/workbench/library";
import { importResources, useLibraryImporting } from "@/workbench/library";
import { savedVersionName } from "@/model/version";
import { distanceOf } from "@/model/trajectory";
import type { PreviewFact } from "@/workbench/library/preview";
import { PreviewFacts, PreviewHeader } from "@/page/shared/resources/info";
import { LibraryToolbar } from "@/page/shared/resources/browser";
import { MapView } from "@/page/shared/preview/map";
import { openResource } from "@/workbench/navigation";
import { Button } from "@/page/shared/ui";
import { VersionDetails, VersionList } from "@/page/shared/documents/versions";

function openEditor(resource: ResourceRef): void {
  closeLibraryPicker();
  openResource(resource);
}

function candidateFacts(candidate: SavedVersionCandidate): PreviewFact[] {
  if (candidate.kind === "trajectory") return [
    ["Duration", duration(candidate.build.track.duration * 1000)],
    ["Distance", `${fixed(distanceOf(candidate.build.track), 1)} m`],
    ["Generated artifact", candidate.build.record.id],
  ];
  const { window, summary, buildId } = candidate.build;
  const outputs = [summary.samples === null ? null : "IQ samples", summary.observation === null ? null : "Observations", summary.position === null ? null : "Position"].filter((value): value is string => value !== null);
  return [
    ["Window start", `${gpsDate(window.startGpsMs)} ${gpsClock(window.startGpsMs)} GPS`],
    ["Duration", duration(window.durationMs)],
    ["Outputs", outputs.join(" · ") || "None"],
    ...(summary.samples === null ? [] : [["Sample format", summary.samples.format], ["Sample rate", `${trimmed(summary.samples.sampleRateHz / 1e6)} Msps`]] as const),
    ...(summary.position === null ? [] : [["Position format", summary.position.format]] as const),
    ["Generated artifact", buildId],
  ];
}

const noSubscription = () => () => {};

export function SavedVersionBrowser() {
  const picker = useStore(libraryPicker, (value) => value.session);
  const reader = picker?.mode === "versions" ? picker.history : null;
  const history = useSyncExternalStore(reader?.state.subscribe ?? noSubscription, () => reader?.state.get() ?? null, () => null);
  const scenarios = useStore(scenarioCatalog, (value) => value);
  const trajectories = useStore(trajectoryCatalog, (value) => value);
  const importing = useLibraryImporting(picker?.id ?? null);
  const input = useRef<HTMLInputElement>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  if (picker?.mode !== "versions") return null;
  const options = picker.options;
  const resource: ResourceRef | null = picker.resourceId === null ? null : { kind: options.kind, id: picker.resourceId };
  const catalog = options.kind === "scenario" ? scenarios : trajectories;
  const resources = [...catalog.entries.values()].map((entry) => entry.head);
  const selectedResource = resources.find((item) => item.id === picker.resourceId);
  const working = picker.resourceId === null ? null : catalog.entries.get(picker.resourceId)?.working ?? null;
  const selection = picker.selection;
  const version = selection?.kind === "saved" ? selection.version : undefined;
  const selected = selection?.kind === "working" ? "working" : version?.id ?? null;
  const candidate = selection?.kind === "saved" && selection.status === "ready" ? selection.candidate : null;
  const preparing = selection?.kind === "saved" && selection.status === "loading";
  const error = selection?.kind === "saved" && selection.status === "error" ? selection.message : null;
  const versions = history?.data?.versions ?? [];
  const builds = history?.data?.builds ?? [];
  const track = candidate?.build.track ?? null;
  const buildId = candidate?.kind === "trajectory" ? candidate.build.record.id : candidate?.build.buildId;
  const busy = picker.busy;

  const words = picker.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const shown = resources.filter((item) => words.every((word) => `${item.summary.name} ${item.id} v${item.headVersionNumber} ${item.archivedAt === null ? "" : "archived"}`.toLocaleLowerCase().includes(word)));
  shown.sort((a, b) => picker.sort === "status"
    ? Number(a.archivedAt !== null) - Number(b.archivedAt !== null) || a.summary.name.localeCompare(b.summary.name, undefined, { numeric: true })
    : a.summary.name.localeCompare(b.summary.name, undefined, { numeric: true }));
  const focusIndex = shown.findIndex((item) => item.id === picker.resourceId);
  const choose = (id: string) => selectLibraryResource({ kind: options.kind, id });
  const upload = (files: File[]) => {
    if (busy || files.length === 0) return;
    void importResources(options.kind, files, true);
  };
  const apply = (id: string) => {
    const current = libraryPicker.get().session;
    if (current?.mode === "versions" && current.selection?.kind === "saved" && current.selection.status === "ready" && current.selection.version.id === id) void useLibrarySelection();
  };
  return <div className="@container flex min-h-0 min-w-0 flex-1 flex-col">
    <LibraryToolbar
      filter={options.kind} query={picker.query} sort={picker.sort} previewOpen={picker.previewOpen}
      picker kinds={[options.kind]} busy={busy}
      onFilterChange={() => {}} onQueryChange={(query) => setLibraryPicker({ query })} onSortChange={(sort) => setLibraryPicker({ sort })}
      onPreviewToggle={() => setLibraryPicker({ previewOpen: !picker.previewOpen })}
      onImport={() => input.current?.click()}
    />
    <input ref={input} type="file" accept=".json,application/json" hidden onChange={(event) => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = "";
      upload(files);
    }} />
    {catalog.error === null ? null : <div role="alert" className="flex items-center gap-3 border-b border-line px-4 py-2 text-small text-fault"><p className="m-0 flex-1">{catalog.error}</p><Button size="xs" onClick={() => void (options.kind === "scenario" ? reloadScenarioCatalog() : reloadTrajectoryCatalog()).catch(() => undefined)}>Retry</Button></div>}
    <div className={`grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] ${picker.previewOpen ? "grid-rows-[minmax(160px,1fr)_minmax(0,1fr)] @min-[880px]:grid-cols-[220px_220px_minmax(0,1fr)] @min-[880px]:grid-rows-1" : "grid-rows-1"}`}>
      <section aria-label={`${options.kind === "trajectory" ? "Trajectory" : "Scenario"} resources`} className="flex min-h-0 min-w-0 flex-col border-r border-line2">
        <h3 className="lab m-0 border-b border-line px-3 py-2 text-small text-ink2">{options.kind === "trajectory" ? "Trajectories" : "Scenarios"}</h3>
        <div role="listbox" aria-label="Saved resources" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {shown.map((item, index) => <button
            key={item.id} type="button" role="option" aria-selected={item.id === picker.resourceId}
            ref={(element) => { if (element === null) rows.current.delete(item.id); else rows.current.set(item.id, element); }}
            tabIndex={index === (focusIndex < 0 ? 0 : focusIndex) ? 0 : -1} disabled={busy}
            onClick={() => choose(item.id)}
            onKeyDown={(event) => {
              if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? shown.length - 1 : Math.max(0, Math.min(shown.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
              const next = shown[nextIndex];
              if (next === undefined) return;
              rows.current.get(next.id)?.focus();
              choose(next.id);
            }}
            className={`flex w-full flex-col gap-1 border-b border-line px-3 py-3 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink disabled:opacity-50 ${item.id === picker.resourceId ? "bg-face shadow-[inset_3px_0_0_var(--ink)]" : "hover:bg-hover"}`}
          >
            <span className="text-small font-semibold [overflow-wrap:anywhere]">{item.summary.name}</span>
            <span className="text-small text-ink3">v{item.headVersionNumber}{item.archivedAt === null ? " · Latest saved" : " · Archived"}</span>
          </button>)}
          {shown.length > 0 ? null : <p role="status" className="m-0 p-4 text-small text-ink3">{catalog.loading || !catalog.loaded && catalog.error === null ? "Loading resources…" : catalog.error !== null ? "Could not load resources." : picker.query.trim() ? "No matching resources." : "No saved resources. Import a JSON file."}</p>}
        </div>
        <div className="border-t border-line px-3 py-2 text-small text-ink3" role="status">{importing ? "Importing…" : `${shown.length} ${shown.length === 1 ? "resource" : "resources"}`}</div>
      </section>
      <section aria-label="Resource versions" className="flex min-h-0 min-w-0 flex-col border-r border-line2">
        <h3 className="lab m-0 border-b border-line px-3 py-2 text-small text-ink2">Versions</h3>
        {history?.status !== "error" ? null : <div role="alert" className="flex flex-col gap-2 p-3 text-small text-fault"><p className="m-0">{history.error}</p><Button size="xs" onClick={() => void refreshLibraryVersions()}>Retry</Button></div>}
        {history?.data == null && (history?.status === "loading" || history?.status === "idle") ? <p role="status" className="m-0 p-4 text-small text-ink3">Loading saved versions…</p> : picker.resourceId === null ? <p className="m-0 p-4 text-small text-ink3">Choose a resource.</p> : <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"><VersionList
          versions={versions} selected={selected === "working" ? null : selected}
          onSelect={(id) => void selectSavedVersion(id)} headVersionId={selectedResource?.headVersionId}
          builds={builds} disabled={busy} onUse={apply}
          working={working === null ? undefined : { selected: selected === "working", label: working.dirty || working.pending ? "Unsaved changes · Save first" : working.recoverable ? "Recoverable draft · Save first" : "Open editor · Save first", onSelect: () => void selectSavedVersion("working") }}
        /></div>}
      </section>
      {!picker.previewOpen ? null : <aside aria-label="Saved version preview" className="col-span-2 flex min-h-0 min-w-0 flex-col overflow-y-auto overscroll-contain border-t border-line2 bg-face @min-[880px]:col-span-1 @min-[880px]:border-t-0">
        {selected === "working" && resource !== null ? <>
          <div className="flex flex-col gap-2 border-b border-line2 p-4">
            <strong className="text-small">Working copy · Save first</strong>
            <p className="m-0 text-small text-ink2">Save a version in the editor to use these changes.</p>
            <Button size="sm" disabled={busy} onClick={() => openEditor(resource)}>Open editor</Button>
          </div>
        </> : version === undefined ? <p className="m-0 p-5 text-small text-ink3">Select a saved version.</p> : <>
          <PreviewHeader title={savedVersionName(version)} kind={`${version.kind === "trajectory" ? "Trajectory" : "Scenario"} · v${version.number} · Read only`} />
          {options.selected?.versionId === version.id ? <p className="m-0 border-b border-line px-4 py-2 text-small text-ink2">Current version</p> : null}
          {track === null ? null : <figure className="m-0 border-b border-line">
            <div className="grid h-[220px] min-h-[180px]"><MapView viewKey={`saved-picker:${buildId}`} variant="preview" scene={{ track, aired: [], markers: [], cursor: 0, following: false }} label={`${savedVersionName(version)} v${version.number} ${candidate?.kind === "scenario" ? "trajectory context" : "preview"}`} /></div>
            <figcaption className="px-4 py-2 text-small text-ink3">{candidate?.kind === "scenario" ? "Full trajectory" : `Saved v${version.number} · generated trajectory`}</figcaption>
          </figure>}
          <div className="flex flex-col gap-4 border-b border-line p-4">
            <p role="status" className={`m-0 text-small ${error === null ? "text-ink2" : "text-fault"}`}>{preparing ? "Preparing version…" : error ?? (candidate === null ? "No generated result." : "Ready to use")}</p>
            {selection?.kind !== "saved" || selection.status !== "error" || !selection.retry ? null : <Button size="sm" disabled={busy} onClick={() => void selectSavedVersion(selection.version.id, true)}>Retry</Button>}
            {candidate === null ? null : <PreviewFacts facts={candidateFacts(candidate)} />}
          </div>
          <div className="p-4"><VersionDetails version={version} previous={versions.find((item) => item.id === version.parentVersionId) ?? null} builds={builds.filter((build) => build.versionId === version.id)} history={versions} /></div>
        </>}
      </aside>}
    </div>
  </div>;
}

export function SavedVersionFooter() {
  const picker = useStore(libraryPicker, (value) => value.session);
  if (picker?.mode !== "versions") return null;
  const selection = picker.selection;
  const selected = selection?.kind === "saved" ? selection.version : undefined;
  const exact = selection?.kind === "saved" && selection.status === "ready";
  const reason = selection?.kind === "working" ? "Save this working copy in the editor before using it."
    : selection?.kind === "saved" && selection.status === "loading" ? "Preparing saved version…"
    : selection?.kind === "saved" && selection.status === "error" ? "Version unavailable. See preview."
    : selected === undefined ? "Choose a saved version." : null;
  return <footer className="flex flex-none flex-wrap items-center gap-3 border-t border-line2 px-4 py-3">
    <Button size="sm" variant="ghost" disabled={picker.busy} onClick={closeLibraryPicker}>Cancel</Button>
    <div className="min-w-0 flex-1 text-small">
      <p className="m-0 truncate text-ink2">{selected === undefined ? selection?.kind === "working" ? "Working copy" : "No version selected" : `${savedVersionName(selected)} · v${selected.number}`}</p>
      {reason === null ? null : <p id="saved-version-use-reason" className={selection?.kind === "working" && picker.previewOpen ? "sr-only" : "m-0 mt-0.5 text-ink3"}>{reason}</p>}
    </div>
    <Button size="sm" variant="primary" disabled={picker.busy || !exact} aria-describedby={reason === null ? undefined : "saved-version-use-reason"} onClick={() => void useLibrarySelection()}>
      {picker.busy ? "Applying…" : selected === undefined ? "Use version" : `Use v${selected.number}`}
    </Button>
  </footer>;
}
