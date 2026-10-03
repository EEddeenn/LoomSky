"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/core";
import { canonicalContent } from "@/model/version";
import { restoreDocumentVersion } from "@/workbench/documents/versions";
import { feedback } from "@/workbench/feedback";
import { page } from "@/workbench/navigation";
import { createVersionHistoryReader } from "@/workbench/documents/versions";
import { Button, Spinner, useFocusScope } from "@/page/shared/ui";
import { DocumentSaveStatus, SaveDocumentButton, SnapshotChanges, VersionDetails, VersionList, useDocumentSaveState, versionLabel, type VersionDocument } from "@/page/shared/documents/versions";

export function VersionHistory({ doc, name, onClose }: { doc: VersionDocument; name: string; onClose(): void }) {
  const { changed, saving } = useDocumentSaveState(doc);
  const [selected, setSelected] = useState<string | null>(() => changed ? null : doc.saved.version.id);
  const reader = useMemo(() => createVersionHistoryReader(doc.id), [doc.id]);
  const { data: history, error } = useStore(reader.state, (state) => state);
  const [restoring, setRestoring] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const activityOpen = useStore(page, (state) => state.activity.open);
  const confirmationOpen = useStore(feedback, (state) => state.confirmation !== null);
  const versionId = doc.saved.version.id;
  const reload = () => { void reader.load(); };
  useFocusScope(dialog, {
    kind: "dialog", enabled: () => !page.get().activity.open,
    initialFocus: () => dialog.current?.querySelector<HTMLButtonElement>('[aria-label="Close version history"]') ?? null,
    onEscape: () => close.current(),
  });

  useEffect(() => {
    void reader.load();
    return () => reader.dispose();
  }, [reader]);

  const versions = history?.versions ?? [doc.saved.version];
  const headVersionId = versions[0]?.id ?? versionId;
  const selectedVersion = versions.find((version) => version.id === selected);
  const previous = selectedVersion === undefined ? null : versions.find((version) => version.id === selectedVersion.parentVersionId) ?? null;
  const currentSnapshot = doc.workingSnapshot;
  const same = selectedVersion !== undefined && canonicalContent(currentSnapshot) === canonicalContent(selectedVersion.snapshot) && !doc.pending && headVersionId === versionId;
  const restore = async () => {
    if (selectedVersion === undefined || restoring) return;
    setRestoring(true);
    try { await restoreDocumentVersion(doc, selectedVersion, () => close.current()); }
    finally { setRestoring(false); }
  };

  return <>
    <div aria-hidden="true" className="absolute inset-x-0 top-12 bottom-0 z-50 bg-scrim" onClick={onClose} />
    <dialog ref={dialog} open tabIndex={-1} aria-modal={!activityOpen && !confirmationOpen} aria-labelledby="version-history-title" onCancel={(event) => { event.preventDefault(); onClose(); }} className="absolute top-[calc(50%+24px)] left-1/2 z-51 m-0 flex h-[min(720px,calc(100%-80px))] w-[min(960px,calc(100%-40px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-layer border-0 bg-panel p-0 text-ink outline-none shadow-[var(--shadow),inset_0_0_0_1px_var(--line2)]">
      <header className="flex flex-none items-start gap-3 border-b border-line2 px-4 py-3">
        <div className="min-w-0 flex-1"><h2 id="version-history-title" className="m-0 text-title font-semibold">{name}</h2><p className="m-0 mt-1 text-small text-ink3">Version history</p></div>
        <Button size="sm" variant="ghost" icon="refresh" iconOnly aria-label="Refresh version history" onClick={reload} />
        <Button size="sm" variant="ghost" icon="x" iconOnly aria-label="Close version history" onClick={onClose} />
      </header>
      {error === null ? null : <div role="alert" className="flex items-center gap-3 border-b border-line2 px-4 py-2 text-small"><p className="m-0 flex-1 text-fault">{error}</p><Button size="xs" onClick={reload}>Retry</Button></div>}
      <div className="grid min-h-0 flex-1 grid-cols-[224px_minmax(0,1fr)]">
        <aside aria-label="Version timeline" className="min-h-0 overflow-y-auto overscroll-contain border-r border-line2 px-2 py-3">
          <VersionList versions={versions} selected={selected} onSelect={setSelected} headVersionId={headVersionId} builds={history?.builds} working={{ selected: selected === null, label: changed ? `Changes since ${versionLabel(doc.saved.version.number)}` : `Matches ${versionLabel(doc.saved.version.number)}`, onSelect: () => setSelected(null) }} />
          {history !== null || error !== null ? null : <p role="status" className="mx-3 flex items-center gap-2 text-small text-ink3"><Spinner />Loading…</p>}
        </aside>
        <section aria-label="Version details" className="min-h-0 overflow-y-auto overscroll-contain p-5">
          {selected === null ? <div className="space-y-5">
            <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><h3 className="m-0 text-title font-semibold">Working copy</h3><div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1"><DocumentSaveStatus doc={doc} /></div></div></div>
            {doc.pending ? <p className="m-0 text-small text-ink3">Save to include your current input in the comparison.</p> : null}
            <SnapshotChanges snapshot={currentSnapshot} previous={doc.saved.version.snapshot} label={`Changes from ${versionLabel(doc.saved.version.number)}`} />
          </div> : selectedVersion === undefined ? <p className="m-0 text-small text-ink3">Saved version unavailable.</p> : <VersionDetails version={selectedVersion} previous={previous} history={versions} />}
        </section>
      </div>
      <footer className="flex flex-none flex-wrap items-center gap-3 border-t border-line2 px-4 py-3">
        <p className="m-0 min-w-0 flex-1 text-small text-ink3">{selected === null ? changed ? "Save creates a new version." : `Matches saved ${versionLabel(doc.saved.version.number)}.` : "Restore replaces the current edits. Save creates a new version."}</p>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        {selected === null ? <SaveDocumentButton doc={doc} /> : <Button size="sm" disabled={same || selectedVersion === undefined || restoring || saving} onClick={() => void restore()}>{restoring ? "Restoring…" : "Restore working copy"}</Button>}
      </footer>
    </dialog>
  </>;
}
