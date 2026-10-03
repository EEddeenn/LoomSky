"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { openScenario, scenarioCatalog, type ScenarioDoc } from "./scenario";
import { openTrajectory, trajectoryCatalog, type TrajectoryDoc } from "./trajectory";
import { DocumentMissingError } from "./collection";
import { useStore } from "@/core";

type DocumentResult<T> = Readonly<{ status: "loading" | "missing" | "error" | "ready"; doc: T | null; error: string | null }>;
type ObservableDocument = { readonly changeVersion: number; subscribe(listener: () => void): () => void };
const noopSubscribe = () => () => {};
function useDocument<T extends ObservableDocument>(id: string | null, open: (id: string, options: { signal: AbortSignal }) => Promise<T>, available: boolean): DocumentResult<T> {
  const [loaded, setLoaded] = useState<{ id: string; result: DocumentResult<T> } | null>(null);
  const result: DocumentResult<T> = id === null ? { status: "missing", doc: null, error: null } : loaded?.id === id ? loaded.result : { status: "loading", doc: null, error: null };
  useEffect(() => {
    if (id === null) return;
    const controller = new AbortController();
    void open(id, { signal: controller.signal }).then((doc) => {
      if (!controller.signal.aborted) setLoaded({ id, result: { status: "ready", doc, error: null } });
    }, (error: unknown) => {
      if (!controller.signal.aborted) setLoaded({ id, result: { status: error instanceof DocumentMissingError ? "missing" : "error", doc: null, error: error instanceof Error ? error.message : String(error) } });
    });
    return () => controller.abort();
  }, [id, open, available]);
  const doc = result.doc;
  useSyncExternalStore(doc === null ? noopSubscribe : (listener) => doc.subscribe(listener), () => doc?.changeVersion ?? 0, () => doc?.changeVersion ?? 0);
  return result;
}
export function useScenarioDocument(id: string | null): DocumentResult<ScenarioDoc> {
  return useDocument(id, openScenario, useStore(scenarioCatalog, (state) => id !== null && state.entries.has(id)));
}
export function useTrajectoryDocument(id: string | null): DocumentResult<TrajectoryDoc> {
  return useDocument(id, openTrajectory, useStore(trajectoryCatalog, (state) => id !== null && state.entries.has(id)));
}
export function useDocumentView(doc: ScenarioDoc | TrajectoryDoc | null, active = true): void {
  useEffect(() => active && doc !== null ? doc.attachView() : undefined, [doc, active]);
  useSyncExternalStore(doc === null ? noopSubscribe : (listener) => doc.subscribe(listener), () => doc?.changeVersion ?? 0, () => doc?.changeVersion ?? 0);
}
