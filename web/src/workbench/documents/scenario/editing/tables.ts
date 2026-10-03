"use client";

import { useEffect } from "react";
import { pathKey } from "@/model/document";
import { useStore } from "@/core";
import type { Path } from "@/model/schema";
import type { ScenarioDoc } from "../document";

function selectionWithin(selected: Set<number>, count: number): Set<number> {
  const indices = [...selected].filter((index) => index >= 0 && index < count);
  return indices.length === selected.size ? selected : new Set(indices);
}

export function useIndexedSelection(doc: ScenarioDoc, path: Path, count: number): [Set<number>, (value: Set<number> | ((before: Set<number>) => Set<number>)) => void] {
  const session = doc.editing;
  const state = session.tables;
  const key = pathKey(doc.kind, path);
  const stored = useStore(state, (state) => state.entries[key]?.selected);
  const selected = selectionWithin(stored ?? new Set<number>(), count);
  useEffect(() => {
    const table = state.get().entries[key];
    if (table === undefined) return;
    const current = selectionWithin(table.selected, count);
    if (current !== table.selected) session.setTable(path, { selected: current });
  }, [session, state, key, path, count, stored]);
  return [selected, (value) => {
    const current = selectionWithin(state.get().entries[key]?.selected ?? new Set<number>(), count);
    session.setTable(path, { selected: selectionWithin(typeof value === "function" ? value(current) : value, count) });
  }];
}

export function useCollectionSelection(doc: ScenarioDoc, path: Path, count: number): [number, (index: number) => void] {
  const session = doc.editing;
  const state = session.collections;
  const key = pathKey(doc.kind, path);
  const remembered = useStore(state, (state) => state.selected[key] ?? 0);
  const selected = Math.max(0, Math.min(remembered, count - 1));
  useEffect(() => {
    if (remembered !== selected) session.selectCollection(path, selected);
  }, [session, path, remembered, selected]);
  return [selected, (index) => session.selectCollection(path, Math.max(0, Math.min(index, count - 1)))];
}
