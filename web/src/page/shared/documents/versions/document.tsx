"use client";

import { useSyncExternalStore } from "react";
import { useStore } from "@/core";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import type { TrajectoryDoc } from "@/workbench/documents/trajectory";
import { saveDocument } from "@/workbench/documents/versions";
import { openProblems } from "@/workbench/feedback";
import { documentView, page } from "@/workbench/navigation";
import { Button, Icon, Spinner } from "../../ui";
import { canDocumentHistory, runDocumentHistory } from "../history";
import { savedTime, versionLabel } from "./format";

export type VersionDocument = ScenarioDoc | TrajectoryDoc;

export function useDocumentSaveState(doc: VersionDocument) {
  useSyncExternalStore(
    (listener) => doc.subscribe(listener),
    () => doc.changeVersion,
    () => 0,
  );
  return { changed: doc.hasUnsavedChanges, saving: doc.saved.state.status === "saving", failed: doc.saved.state.status === "error" };
}

export function VersionChip({ doc, onClick }: { doc: VersionDocument; onClick(): void }) {
  useDocumentSaveState(doc);
  return <button type="button" aria-label={`Version history, saved ${versionLabel(doc.saved.version.number)}`} title={`Saved ${savedTime(doc.saved.version.savedAt)} · Version history`} onClick={onClick} className="fn inline-flex h-7 shrink-0 items-center gap-1 rounded-key px-1.5 text-small text-ink2 hover:bg-hover hover:text-ink">
    {versionLabel(doc.saved.version.number)}<Icon name="chev" size={12} />
  </button>;
}

export function DocumentSaveStatus({ doc }: { doc: VersionDocument }) {
  const { changed, saving, failed } = useDocumentSaveState(doc);
  if (saving) return <span role="status" className="inline-flex items-center gap-1.5 text-small text-ink2"><Spinner />Saving…</span>;
  if (failed) return <button type="button" className="text-small text-fault underline underline-offset-3" onClick={() => openProblems(`document:${doc.kind}:${doc.id}:save`)}>Save failed</button>;
  return changed
    ? <span className="inline-flex items-center gap-1.5 text-small text-ink2"><span className="size-1.5 rounded-full bg-ink3" />Unsaved</span>
    : <span className="text-small text-ink3">Saved</span>;
}

export function DocumentHistoryButtons({ doc }: { doc: VersionDocument }) {
  const view = useStore(page, (state) => documentView(state.route));
  const available = useSyncExternalStore((listener) => {
    const unsubscribeDocument = doc.subscribe(listener);
    const unsubscribeEditing = doc.kind === "trajectory" ? doc.editing.subscribe(listener) : () => {};
    return () => { unsubscribeDocument(); unsubscribeEditing(); };
  }, () => Number(canDocumentHistory(doc, "undo", view)) | Number(canDocumentHistory(doc, "redo", view)) << 1, () => 0);
  return <div role="group" aria-label="Edit history" className="flex items-center gap-0.5">
    <Button size="sm" variant="ghost" disabled={(available & 1) === 0} title="Undo (⌘/Ctrl+Z)" onClick={() => runDocumentHistory(doc, "undo", view)}>Undo</Button>
    <Button size="sm" variant="ghost" disabled={(available & 2) === 0} title="Redo (⌘/Ctrl+Shift+Z)" onClick={() => runDocumentHistory(doc, "redo", view)}>Redo</Button>
  </div>;
}

export function SaveDocumentButton({ doc }: { doc: VersionDocument }) {
  const { changed, saving } = useDocumentSaveState(doc);
  return <Button size="sm" variant={changed ? "primary" : "default"} disabled={saving || !changed} title={changed ? "Save a new version (⌘/Ctrl+S)" : "No unsaved changes"} onClick={() => void saveDocument(doc)}>
    {saving ? "Saving…" : "Save"}
  </Button>;
}
