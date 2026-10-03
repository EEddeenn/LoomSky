"use client";

import { useRef } from "react";
import { useStore } from "@/core";
import type { ResourceRef } from "@/model/resource";
import { acceptsLibraryResource, focusLibraryResource, libraryBrowse, libraryPicker, selectLibraryResource, setLibraryBrowse, setLibraryPicker, type LibraryKind } from "@/workbench/library";
import { importResources, useLibraryImporting, type ImportKind } from "@/workbench/library";
import { openProblems } from "@/workbench/feedback";
import { openResource } from "@/workbench/navigation";
import { Button } from "@/page/shared/ui";
import { ResourceActions } from "@/page/shared/resources/actions";
import { LibraryList } from "./browser/list";
import { LibraryPreview } from "./preview";
import { LibraryRail } from "./browser/rail";
import { useLibraryEntries } from "./summary";
import { LibraryToolbar } from "./browser/toolbar";

export { LibraryToolbar };

const allKinds: readonly LibraryKind[] = ["scenario", "trajectory", "file", "host"];

export function LibraryBrowser({ picker = false }: { picker?: boolean }) {
  const browse = useStore(libraryBrowse, (state) => state);
  const session = useStore(libraryPicker, (state) => state.session);
  const selection = picker && session?.mode === "resources" ? session : null;
  const { entries, loading, error } = useLibraryEntries();
  const state = selection ?? browse;
  const request = selection?.options ?? null;
  const kinds = request?.kinds ?? allKinds;
  const selected = selection?.selected ?? (browse.selected === null ? [] : [browse.selected]);
  const focused = selection === null ? browse.selected : selection.focused;
  const importing = useLibraryImporting(picker ? session?.id ?? null : null);
  const input = useRef<HTMLInputElement>(null);
  const importKind = useRef<ImportKind>("file");

  const eligible = entries.filter((entry) => acceptsLibraryResource(entry.resource, request));
  const counts: Record<LibraryKind, number> = { scenario: 0, trajectory: 0, file: 0, host: 0 };
  for (const entry of eligible) counts[entry.resource.kind]++;
  const words = state.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const shown = eligible.filter((entry) => (
    (state.filter === "all" || entry.resource.kind === state.filter)
      && words.every((word) => `${entry.name} ${entry.type} ${entry.status} ${entry.secondary}`.toLocaleLowerCase().includes(word))
  ));
  shown.sort((a, b) => (
    a[state.sort].localeCompare(b[state.sort], undefined, { numeric: true, sensitivity: "base" })
      || a.name.localeCompare(b.name)
  ));

  const update = picker ? setLibraryPicker : setLibraryBrowse;
  const pick = (resource: ResourceRef) => {
    if (picker) selectLibraryResource(resource);
    else setLibraryBrowse({ selected: resource });
  };
  const chooseImport = (kind: ImportKind) => {
    importKind.current = kind;
    if (input.current === null) return;
    input.current.accept = kind === "scenario" || kind === "trajectory" ? ".json,application/json" : request?.fileAccept ?? "";
    input.current.click();
  };
  const upload = (files: File[]) => {
    if (files.length === 0) return;
    void importResources(importKind.current, files, picker);
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <LibraryToolbar
        filter={state.filter} query={state.query} sort={state.sort} previewOpen={state.previewOpen}
        picker={picker} kinds={kinds} busy={selection?.busy ?? false}
        onFilterChange={(filter) => update({ filter, scroll: 0 })}
        onQueryChange={(query) => update({ query, scroll: 0 })}
        onSortChange={(sort) => update({ sort, scroll: 0 })}
        onPreviewToggle={() => update({ previewOpen: !state.previewOpen })}
        onImport={chooseImport}
      />
      <input
        ref={input} type="file" multiple={!picker || request?.multiple === true} hidden
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          upload(files);
        }}
      />
      {error ? (
        <div className="flex flex-none items-center gap-2 border-b border-line px-3 py-2 text-small text-warn-ink">
          <span>Some resources failed to load.</span>
          <Button size="xs" variant="ghost" onClick={() => openProblems()}>View problems</Button>
        </div>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1">
        {picker ? null : <LibraryRail filter={state.filter} counts={counts} onFilterChange={(filter) => update({ filter, scroll: 0 })} />}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Library resources">
          <LibraryList
            restore={!picker} ready={!loading}
            resetKey={JSON.stringify([state.filter, state.query, state.sort])}
            entries={shown} selected={selected} focused={focused} multiple={picker && request?.multiple === true}
            onSelect={pick}
            onFocus={picker ? focusLibraryResource : undefined}
            onOpen={picker ? undefined : openResource}
            renderActions={picker ? undefined : (entry) => <ResourceActions resource={entry.resource} name={entry.name} />}
            scrollTop={state.scroll} onScroll={(scroll) => update({ scroll })}
            emptyMessage={loading ? "Loading resources…" : state.query !== "" ? "No matching resources." : picker ? "No resources yet. Upload a file." : "No resources yet. Import or create one."}
          />
          <div className="flex min-h-7 flex-none items-center border-t border-line px-3 text-small text-ink3" role="status">
            {importing ? "Importing…" : `${shown.length} ${shown.length === 1 ? "resource" : "resources"}`}
          </div>
        </section>
        {state.previewOpen ? (
          <aside aria-label="Resource preview" className="flex w-[360px] min-w-0 flex-none flex-col overflow-hidden border-l border-line2 bg-panel">
            <LibraryPreview resource={focused} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
