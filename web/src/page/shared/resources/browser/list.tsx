"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useStore } from "@/core";
import { resourceKey, type ResourceRef } from "@/model/resource";
import { useViewport } from "../../navigation";
import { page } from "@/workbench/navigation";
import type { ResourceSummary } from "../summary";

const tones = {
  normal: "text-ink2",
  warning: "text-warn-ink",
  error: "text-fault",
  active: "text-rf-ink",
};

export function LibraryList({ entries, selected, focused, multiple, onSelect, onFocus, onOpen, renderActions, scrollTop, onScroll, emptyMessage, restore = false, ready = true, resetKey = "" }: {
  entries: ResourceSummary[];
  selected: ResourceRef[];
  focused: ResourceRef | null;
  multiple: boolean;
  onSelect: (resource: ResourceRef) => void;
  onFocus?: (resource: ResourceRef) => void;
  onOpen?: (resource: ResourceRef) => void;
  renderActions?: (entry: ResourceSummary) => ReactNode;
  scrollTop: number;
  onScroll: (top: number) => void;
  emptyMessage: string;
  restore?: boolean;
  ready?: boolean;
  resetKey?: string;
}) {
  const visitId = useStore(page, (state) => state.visitId);
  const scroll = useRef<HTMLDivElement>(null);
  useViewport(scroll, "library:list", restore && ready);
  const previousScroll = useRef<{ visitId: number; scrollTop: number; resetKey: string } | null>(null);
  const rows = useRef(new Map<string, HTMLTableRowElement>());
  const selectedKeys = new Set(selected.map(resourceKey));
  const focusedKey = focused === null ? null : resourceKey(focused);
  const focusIndex = entries.findIndex((entry) => resourceKey(entry.resource) === focusedKey);
  useLayoutEffect(() => {
    const previous = previousScroll.current;
    previousScroll.current = { visitId, scrollTop, resetKey };
    if (scroll.current === null) return;
    if (!restore) scroll.current.scrollTop = scrollTop;
    else if (previous !== null && previous.visitId === visitId
      && (previous.resetKey !== resetKey || (scrollTop === 0 && previous.scrollTop !== 0))) scroll.current.scrollTop = 0;
  }, [restore, visitId, scrollTop, resetKey]);
  return (
    <div
      ref={scroll}
      onScroll={(event) => onScroll(event.currentTarget.scrollTop)}
      className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain"
    >
      <table role="grid" aria-label="Library resources" aria-multiselectable={multiple} className="w-full table-fixed border-collapse text-left">
        <colgroup>
          {multiple ? <col className="w-9" /> : null}
          <col />
          <col className="w-20" />
          <col className="w-24" />
          {renderActions === undefined ? null : <col className="w-24" />}
        </colgroup>
        <thead className="sticky top-0 z-1 bg-panel text-label text-ink2">
          <tr className="border-b border-line2">
            {multiple ? <th scope="col"><span className="vh">Select</span></th> : null}
            <th scope="col" className="px-3 py-2 font-medium">Name</th>
            <th scope="col" className="px-2 py-2 font-medium">Type</th>
            <th scope="col" className="px-2 py-2 font-medium">Status</th>
            {renderActions === undefined ? null : <th scope="col"><span className="vh">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => {
            const key = resourceKey(entry.resource);
            const isSelected = selectedKeys.has(key);
            const isFocused = key === focusedKey;
            return (
              <tr
                key={key}
                ref={(element) => {
                  if (element === null) rows.current.delete(key);
                  else rows.current.set(key, element);
                }}
                tabIndex={index === (focusIndex < 0 ? 0 : focusIndex) ? 0 : -1}
                aria-selected={isSelected}
                onFocus={multiple ? () => onFocus?.(entry.resource) : undefined}
                onClick={(event) => {
                  if (event.detail > 1) return;
                  event.currentTarget.focus({ preventScroll: true });
                  onSelect(entry.resource);
                }}
                onDoubleClick={onOpen === undefined ? undefined : () => onOpen(entry.resource)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === " ") {
                    event.preventDefault();
                    onSelect(entry.resource);
                  } else if (event.key === "Enter" && onOpen !== undefined) {
                    event.preventDefault();
                    onOpen(entry.resource);
                  } else if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
                    event.preventDefault();
                    const nextIndex = event.key === "Home" ? 0
                      : event.key === "End" ? entries.length - 1
                      : Math.max(0, Math.min(entries.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
                    const next = entries[nextIndex];
                    if (next === undefined) return;
                    const row = rows.current.get(resourceKey(next.resource));
                    row?.focus({ preventScroll: true });
                    row?.scrollIntoView({ block: "nearest" });
                    if (!multiple) onSelect(next.resource);
                  }
                }}
                className={`cursor-default border-b border-line align-top outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink ${isFocused ? "bg-face shadow-[inset_3px_0_0_var(--ink)]" : isSelected ? "bg-hover" : "hover:bg-hover"}`}
              >
                {multiple ? (
                  <td className="py-3 pl-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      aria-label={`Select ${entry.name}`}
                      onClick={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                      onChange={() => onSelect(entry.resource)}
                      className="mt-0.5 size-3.5 accent-ink"
                    />
                  </td>
                ) : null}
                <td className="min-w-0 px-3 py-3">
                  <span className="block font-semibold [overflow-wrap:anywhere]">{entry.name}</span>
                  {entry.secondary === "" ? null : <span className="mt-1 block text-small text-ink3 [overflow-wrap:anywhere]">{entry.secondary}</span>}
                </td>
                <td className="px-2 py-3 text-small text-ink2 [overflow-wrap:anywhere]">{entry.type}</td>
                <td className={`px-2 py-3 text-small [overflow-wrap:anywhere] ${tones[entry.tone ?? "normal"]}`}>{entry.status}</td>
                {renderActions === undefined ? null : (
                  <td onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} className="px-2 py-2">
                    <div className="flex flex-wrap items-center justify-end gap-1">{renderActions(entry)}</div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {entries.length === 0 ? <p role="status" className="m-0 px-5 py-8 text-ink2">{emptyMessage}</p> : null}
    </div>
  );
}
