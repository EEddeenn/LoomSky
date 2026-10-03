"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import type { BuildRecord, SavedVersion } from "@/model/version";
import { savedTime, versionLabel } from "./format";

export function VersionList({ versions, selected, onSelect, working, headVersionId, builds = [], onUse, disabled = false }: {
  versions: readonly SavedVersion[];
  selected: string | null;
  onSelect(id: string): void;
  working?: { selected: boolean; label: string; onSelect(): void };
  headVersionId?: string;
  builds?: readonly BuildRecord[];
  onUse?(id: string): void;
  disabled?: boolean;
}) {
  const list = useRef<HTMLDivElement>(null);
  const keys = [...(working === undefined ? [] : ["working"]), ...versions.map((version) => version.id)];
  const select = (key: string) => key === "working" ? working?.onSelect() : onSelect(key);
  const active = working?.selected ? "working" : selected;
  const focusKey = active !== null && keys.includes(active) ? active : keys[0];
  useEffect(() => { list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [active, versions]);
  const keyboard = (event: KeyboardEvent, key: string) => {
    if (disabled) return;
    const index = keys.indexOf(key);
    let next: string | undefined;
    if (event.key === "ArrowDown") next = keys[Math.min(keys.length - 1, index + 1)];
    else if (event.key === "ArrowUp") next = keys[Math.max(0, index - 1)];
    else if (event.key === "Home") next = keys[0];
    else if (event.key === "End") next = keys.at(-1);
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select(key);
      if (event.key === "Enter" && key !== "working") onUse?.(key);
      return;
    }
    if (next === undefined) return;
    event.preventDefault();
    select(next);
    list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[keys.indexOf(next)]?.focus();
  };
  const node = (solid: boolean, pending = false) => <span aria-hidden="true" className={`relative z-1 mt-1.5 size-2 shrink-0 rounded-full border ${solid ? "border-ink bg-ink" : `border-ink3 bg-panel ${pending ? "border-dashed" : ""}`}`} />;
  const row = "relative flex w-full gap-3 rounded-key px-3 py-2.5 text-left text-small outline-offset-[-2px] disabled:opacity-50 after:absolute after:top-6 after:bottom-[-10px] after:left-[15.5px] after:w-px after:bg-line2 last:after:hidden";
  return <div ref={list} role="listbox" aria-label="Saved versions" className="flex min-w-0 flex-col">
    {working === undefined ? null : <button type="button" role="option" aria-selected={working.selected} tabIndex={focusKey === "working" ? 0 : -1} disabled={disabled} onClick={working.onSelect} onKeyDown={(event) => keyboard(event, "working")} className={`${row} ${working.selected ? "bg-hover" : "hover:bg-face"}`}>
      {node(false, true)}
      <span className="min-w-0"><span className="block font-semibold">Working copy</span><span className="mt-0.5 block text-ink3">{working.label}</span></span>
    </button>}
    {versions.map((version) => {
      const build = builds.find((candidate) => candidate.versionId === version.id);
      const head = version.id === headVersionId;
      return <button key={version.id} type="button" role="option" aria-selected={selected === version.id && !working?.selected} tabIndex={focusKey === version.id ? 0 : -1} disabled={disabled} onClick={() => onSelect(version.id)} onDoubleClick={() => onUse?.(version.id)} onKeyDown={(event) => keyboard(event, version.id)} className={`${row} ${selected === version.id && !working?.selected ? "bg-hover" : "hover:bg-face"}`}>
        {node(head)}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2"><span className="fn font-semibold">{versionLabel(version.number)}</span>{head ? <span className="text-ink3">Latest</span> : null}</span>
          <time dateTime={new Date(version.savedAt).toISOString()} title={savedTime(version.savedAt)} className="mt-0.5 block text-ink3">{savedTime(version.savedAt, true)}</time>
          {version.note === undefined || version.note === "" ? null : <span className="mt-1 block truncate text-ink2">{version.note}</span>}
          {build === undefined ? null : <span className={`mt-1 block ${build.status === "failure" ? "text-fault" : "text-ink2"}`}>{build.status === "success" ? "Verified" : "Check failed"}</span>}
        </span>
      </button>;
    })}
  </div>;
}
