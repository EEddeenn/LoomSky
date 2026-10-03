"use client";

import { useSyncExternalStore } from "react";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import type { TrajectoryDoc } from "@/workbench/documents/trajectory";
import { copyScenario } from "@/workbench/documents/scenario/actions";
import { copyTrajectory } from "@/workbench/documents/trajectory/actions";
import { draftCount } from "@/workbench/documents/editing";
import { reloadDocument, saveDocument } from "@/workbench/documents/versions";
import { openProblems } from "@/workbench/feedback";
import { Button, Icon, Spinner } from "../../ui";
import { savedTime, versionLabel } from "./format";

export type VersionDocument = ScenarioDoc | TrajectoryDoc;

export function useDocumentSaveState(doc: VersionDocument) {
  useSyncExternalStore(
    (listener) => doc.subscribe(listener),
    () => doc.changeVersion,
    () => 0,
  );
  const fields = draftCount(doc.editor);
  const pending = fields + (doc.kind === "trajectory" && doc.editing.nameDraft !== null ? 1 : 0);
  return { dirty: doc.saved.dirty, pending, unapplied: doc.editing.unapplied, saving: doc.saved.state.status === "saving", failed: doc.saved.state.status === "error", conflict: doc.saved.state.status === "conflict" };
}

export function VersionChip({ doc, onClick }: { doc: VersionDocument; onClick(): void }) {
  useDocumentSaveState(doc);
  return <button type="button" aria-label={`Version history, saved ${versionLabel(doc.saved.version.number)}`} title={`Saved ${savedTime(doc.saved.version.savedAt)} · Version history`} onClick={onClick} className="fn inline-flex h-7 shrink-0 items-center gap-1 rounded-key px-1.5 text-small text-ink2 hover:bg-hover hover:text-ink">
    {versionLabel(doc.saved.version.number)}<Icon name="chev" size={12} />
  </button>;
}

export function DocumentSaveStatus({ doc }: { doc: VersionDocument }) {
  const { dirty, pending, unapplied, saving, failed, conflict } = useDocumentSaveState(doc);
  return <>
    {dirty ? <span className="inline-flex items-center gap-1.5 text-small text-ink2"><span className="size-1.5 rounded-full bg-ink3" />Unsaved changes</span> : pending === 0 && !saving && !failed && !conflict ? <span className="text-small text-ink3">Saved</span> : null}
    {pending > 0 ? <span className="text-small text-ink3">{pending} unapplied input{pending === 1 ? "" : "s"}</span> : null}
    {unapplied ? <span className="text-small text-ink3">Unapplied edits</span> : null}
    {saving ? <span role="status" className="inline-flex items-center gap-1.5 text-small text-ink2"><Spinner />Saving…</span> : null}
    {failed ? <button type="button" className="text-small text-fault underline underline-offset-3" onClick={() => openProblems(`document:${doc.kind}:${doc.id}:save`)}>Save failed</button> : null}
    {conflict ? <span className="text-small text-warn-ink">{doc.saved.syncState.status === "archived" ? "Archived in another tab" : doc.saved.syncState.status === "missing" ? "No longer stored" : "New saved version available"}</span> : null}
  </>;
}

export function SaveDocumentButton({ doc }: { doc: VersionDocument }) {
  const { dirty, pending, unapplied, saving, conflict } = useDocumentSaveState(doc);
  const changed = dirty || pending > 0 || unapplied;
  return <Button size="sm" variant={changed ? "primary" : "default"} disabled={saving || conflict || !changed} title={conflict ? "Resolve the version conflict before saving" : unapplied ? "Save applied changes (⌘/Ctrl+S)" : changed ? `Save as ${versionLabel(doc.saved.version.number + 1)} (⌘/Ctrl+S)` : "No unsaved changes"} onClick={() => void saveDocument(doc)}>
    {saving ? "Saving…" : "Save"}
  </Button>;
}

export function DocumentSyncNotice({ doc, onHistory }: { doc: VersionDocument; onHistory(): void }) {
  const { saving, conflict } = useDocumentSaveState(doc);
  if (!conflict) return null;
  const state = doc.saved.syncState;
  const unavailable = state.status === "archived" || state.status === "missing";
  return <div role="status" className="flex flex-none flex-wrap items-center gap-3 border-b border-line2 bg-face px-4 py-2 text-small">
    <p className="m-0 min-w-0 flex-1 text-warn-ink">{unavailable
      ? state.status === "archived" ? "Archived in another tab. Your working copy remains here." : "No longer stored. Your working copy remains here."
      : `Another tab saved ${state.status === "changed" ? versionLabel(state.head.headVersionNumber) : "a newer version"}. Local edits and Undo history remain.`}</p>
    <Button size="xs" variant="ghost" onClick={onHistory}>View versions</Button>
    {unavailable ? null : <Button size="xs" disabled={saving || doc.editing.busy} onClick={() => void reloadDocument(doc)}>Load latest…</Button>}
    <Button size="xs" disabled={saving || doc.editing.busy} onClick={() => void (doc.kind === "scenario" ? copyScenario(doc) : copyTrajectory(doc))}>Save a copy</Button>
  </div>;
}
