"use client";

import { useEffect, useRef } from "react";
import { useStore } from "@/core";
import { closeLibraryPicker, libraryPicker, clearLibrarySelection, useLibrarySelection } from "@/workbench/library";
import { page } from "@/workbench/navigation";
import { feedback, openProblems } from "@/workbench/feedback";
import { Button, useFocusScope } from "@/page/shared/ui";
import { LibraryBrowser } from "@/page/shared/resources/browser";
import { SavedVersionBrowser, SavedVersionFooter } from "./library-picker/versions";

export function LibraryPicker() {
  const session = useStore(libraryPicker, (value) => value.session);
  return session === null ? null : <Picker key={session.id} />;
}

function Picker() {
  const state = useStore(libraryPicker, (value) => value.session);
  const activityOpen = useStore(page, (value) => value.activity.open);
  const confirmationOpen = useStore(feedback, (value) => value.confirmation !== null);
  const dialog = useRef<HTMLDialogElement>(null);
  useFocusScope(dialog, {
    kind: "dialog", enabled: () => !page.get().activity.open,
    initialFocus: () => dialog.current?.querySelector<HTMLInputElement>('input[type="search"]') ?? null,
    onEscape: closeLibraryPicker,
  });
  useEffect(() => {
    if (state?.busy && !activityOpen && dialog.current?.contains(document.activeElement)) dialog.current.focus({ preventScroll: true });
  }, [state?.busy, activityOpen]);
  if (state === null) return null;
  return <>
    <div className="absolute inset-x-0 top-12 bottom-0 z-50 bg-scrim" aria-hidden="true" onClick={closeLibraryPicker} />
    <dialog
      ref={dialog} open tabIndex={-1} aria-modal={!activityOpen && !confirmationOpen} aria-labelledby="library-picker-title"
      onCancel={(event) => { event.preventDefault(); closeLibraryPicker(); }}
      className="absolute top-[calc(50%+24px)] left-1/2 z-51 m-0 flex h-[min(760px,calc(100%-80px))] max-h-[calc(100%-80px)] w-[min(1080px,calc(100%-40px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-layer border-0 bg-panel p-0 text-ink outline-none shadow-[var(--shadow),inset_0_0_0_1px_var(--line2)]"
    >
      <header className="flex flex-none items-start gap-3 border-b border-line2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 id="library-picker-title" className="m-0 text-title font-semibold">{state.options.title}</h2>
          {state.options.description === undefined ? null : <p className="m-0 mt-1 text-small text-ink2">{state.options.description}</p>}
        </div>
        <Button size="sm" variant="ghost" icon="x" iconOnly aria-label="Close resource picker" disabled={state.busy} onClick={closeLibraryPicker} />
      </header>
      {state.mode === "versions" ? <SavedVersionBrowser key={state.id} /> : <LibraryBrowser key={state.id} picker />}
      {state.error === null ? null : (
        <div role="alert" className="flex flex-none items-center gap-3 border-t border-line px-4 py-2 text-small">
          <p className="m-0 flex-1 text-fault">{state.error}</p>
          <Button size="xs" variant="ghost" onClick={() => openProblems()}>View problems</Button>
        </div>
      )}
      {state.mode === "versions" ? <SavedVersionFooter /> : <footer className="flex flex-none items-center gap-3 border-t border-line2 px-4 py-3">
        <Button size="sm" variant="ghost" disabled={state.busy} onClick={closeLibraryPicker}>Cancel</Button>
        <span className="text-small text-ink2">{state.selected.length} selected</span>
        {state.selected.length === 0 ? null : <Button size="xs" variant="ghost" disabled={state.busy} onClick={clearLibrarySelection}>Clear selection</Button>}
        <span className="flex-1" />
        <Button size="sm" variant="primary" disabled={state.busy || state.selected.length === 0} onClick={() => void useLibrarySelection()}>
          {state.busy ? "Applying…" : state.options.useLabel ?? (state.options.multiple ? "Use files" : "Use resource")}
        </Button>
      </footer>}
    </dialog>
  </>;
}
