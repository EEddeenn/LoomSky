"use client";

import { useId, useState } from "react";
import { createTrajectory } from "@/workbench/documents/trajectory/actions";
import type { ImportKind } from "@/workbench/library";
import type { LibraryFilter, LibraryKind, LibrarySort } from "@/workbench/library";
import { Button, closePopover, Popover, TextInput } from "@/page/shared/ui";
import { NewScenario } from "./new/scenario";
import { AddHost } from "./new/host";

const kindLabels = { scenario: "Scenarios", trajectory: "Trajectories", file: "Data files", host: "Transmitters" } as const;
const importLabels: Record<ImportKind, string> = { scenario: "Scenario JSON…", trajectory: "Trajectory JSON…", file: "Data file…" };

export function LibraryToolbar({ filter, query, sort, previewOpen, picker, kinds, busy, onFilterChange, onQueryChange, onSortChange, onPreviewToggle, onImport }: {
  filter: LibraryFilter;
  query: string;
  sort: LibrarySort;
  previewOpen: boolean;
  picker: boolean;
  kinds: readonly LibraryKind[];
  busy: boolean;
  onFilterChange(filter: LibraryFilter): void;
  onQueryChange(query: string): void;
  onSortChange(sort: LibrarySort): void;
  onPreviewToggle(): void;
  onImport(kind: ImportKind): void;
}) {
  const id = useId();
  const [creating, setCreating] = useState(false);
  const disabled = busy || creating;
  const imports = kinds.filter((kind): kind is ImportKind => kind !== "host");
  const firstImport = imports[0];

  const makeTrajectory = async () => {
    if (disabled) return;
    setCreating(true);
    try {
      await createTrajectory();
    } finally {
      setCreating(false);
    }
  };
  const openPopover = (target: string, element: HTMLElement) => { closePopover(element); document.getElementById(target)?.showPopover(); };
  return <>
    <div className="flex min-w-0 flex-none flex-wrap items-center gap-2 border-b border-line2 bg-panel px-3 py-3">
      {picker && kinds.length > 1 ? (
        <select aria-label="Resource type" value={filter} disabled={busy} onChange={(event) => onFilterChange(event.target.value as LibraryFilter)} className="h-8 max-w-40 rounded-key bg-face px-2 ring-field disabled:cursor-not-allowed disabled:opacity-50">
          <option value="all">All types</option>
          {kinds.map((kind) => <option key={kind} value={kind}>{kindLabels[kind]}</option>)}
        </select>
      ) : null}
      <TextInput type="search" aria-label="Search Library" placeholder="Search Library" value={query} disabled={busy} onChange={(event) => onQueryChange(event.target.value)} className="min-w-32 max-w-[440px] flex-1" />
      <select aria-label="Sort resources" value={sort} disabled={busy} onChange={(event) => onSortChange(event.target.value as LibrarySort)} className="h-8 w-24 flex-none rounded-key bg-face px-2 text-small ring-field disabled:cursor-not-allowed disabled:opacity-50">
        <option value="name">Name</option><option value="type">Type</option><option value="status">Status</option>
      </select>
      <span className="flex-1" />
      {picker ? null : <>
        <Button id={`${id}-new`} icon="plus" popoverTarget={`${id}-new-menu`} disabled={disabled}>New</Button>
        <Popover id={`${id}-new-menu`} anchor={`${id}-new`} width={230} role="menu" label="New resource">
          <NewScenario busy={disabled} onBusyChange={setCreating} />
          <button type="button" role="menuitem" className="px-3 py-2 text-left hover:bg-hover" onClick={(event) => { closePopover(event.currentTarget); void makeTrajectory(); }}>Trajectory</button>
          <button type="button" role="menuitem" className="border-t border-line px-3 py-2 text-left hover:bg-hover" onClick={(event) => openPopover("add-host-popover", event.currentTarget)}>Add transmitter…</button>
        </Popover>
      </>}
      {firstImport === undefined ? null : imports.length === 1 && picker ? (
        <Button icon="upload" disabled={disabled} onClick={() => onImport(firstImport)}>Upload…</Button>
      ) : (
        <>
          <Button id={`${id}-import`} icon="upload" popoverTarget={`${id}-import-menu`} disabled={disabled}>{picker ? "Upload" : "Import"}</Button>
          <Popover id={`${id}-import-menu`} anchor={`${id}-import`} width={220} role="menu" label="Import resource">
            {imports.map((kind) => (
              <button
                key={kind} type="button" role="menuitem" className="px-3 py-2 text-left hover:bg-hover"
                onClick={(event) => { closePopover(event.currentTarget); onImport(kind); }}
              >
                {importLabels[kind]}
              </button>
            ))}
          </Popover>
        </>
      )}
      <Button variant="ghost" icon="layers" aria-pressed={previewOpen} disabled={busy} onClick={onPreviewToggle} title={previewOpen ? "Hide preview" : "Show preview"}>Preview</Button>
    </div>
    {picker ? null : <AddHost anchor={`${id}-new`} />}
  </>;
}
