"use client";

import { useId, useMemo, useState } from "react";
import { discardDocumentDraft, restoreDocumentDraft, useDocumentDrafts } from "@/workbench/documents/recovery";
import { reportProblem, requestConfirmation, resolveProblem } from "@/workbench/feedback";
import { Button, closePopover, Popover, PopoverBody, PopoverFooter, PopoverHead, Spinner } from "@/page/shared/ui";

function DraftList({ restoring, onRestoring }: { restoring: string | null; onRestoring(id: string | null): void }) {
  const { heads, loading, error, refresh } = useDocumentDrafts();
  const drafts = useMemo(() => [...heads].sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)), [heads]);
  return (
    <>
      <PopoverBody>
        <p className="m-0 text-small text-ink2">Recover edits stored in this browser.</p>
        {loading ? <p role="status" className="m-0 flex items-center gap-2 text-small text-ink2"><Spinner />Loading drafts…</p> : null}
        {error === null ? null : <p role="alert" className="m-0 text-small text-fault">{error}</p>}
        {!loading && error === null && drafts.length === 0 ? <p className="m-0 py-3 text-small text-ink3">No recovery drafts.</p> : null}
        {drafts.length === 0 ? null : (
          <ul aria-label="Recovery drafts" className="m-0 flex list-none flex-col gap-2 p-0">
            {drafts.map((head) => {
              const name = head.summary.name || head.resourceId;
              const kind = head.kind === "scenario" ? "Scenario" : "Trajectory";
              const updated = new Date(head.updatedAt);
              const updatedLabel = updated.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
              return (
                <li key={head.id} className="flex flex-wrap items-center gap-3 rounded-key border border-line2 p-3">
                  <div className="min-w-0 flex-1 basis-48">
                    <h3 className="m-0 break-words text-body font-medium">{name}</h3>
                    <p className="mt-1 mb-0 text-small text-ink2">{kind} · <time dateTime={updated.toISOString()}>{updatedLabel}</time></p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm" disabled={restoring !== null} aria-label={`Restore draft ${name}`}
                      onClick={async (event) => {
                        if (restoring !== null) return;
                        const button = event.currentTarget;
                        const problemId = `draft:${head.id}:restore`;
                        onRestoring(head.id);
                        try {
                          await restoreDocumentDraft(head);
                          resolveProblem(problemId);
                          closePopover(button);
                        } catch (failure) {
                          reportProblem({
                            id: problemId, level: "error", scope: "Draft recovery", title: "Could not restore draft",
                            message: failure instanceof Error ? failure.message : String(failure), location: name,
                          });
                        } finally {
                          onRestoring(null);
                        }
                      }}
                    >{restoring === head.id ? "Restoring…" : "Restore"}</Button>
                    <Button
                      size="sm" variant="ghost" disabled={restoring !== null} aria-label={`Discard draft ${name}`}
                      onClick={(event) => {
                        closePopover(event.currentTarget);
                        requestConfirmation({
                          id: `discard-draft:${head.id}:${head.revision}`, scope: "Draft recovery", title: "Discard recovery draft?",
                          message: "Delete this draft, its unsaved input, and editing history? This cannot be undone.",
                          details: [{ label: kind, value: name }, { label: "Last updated", value: updatedLabel }],
                          confirmLabel: "Discard draft",
                          confirm: () => discardDocumentDraft(head),
                        });
                      }}
                    >Discard</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverBody>
      <PopoverFooter>
        <Button size="sm" variant="ghost" disabled={loading || restoring !== null} onClick={refresh}>Refresh</Button>
        <span className="flex-1" />
        <Button size="sm" data-autofocus onClick={(event) => closePopover(event.currentTarget)}>Close</Button>
      </PopoverFooter>
    </>
  );
}

export function RecoverDrafts() {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const anchor = `${id}-recover-drafts`;
  const popover = `${id}-drafts`;
  return (
    <>
      <Button id={anchor} size="sm" popoverTarget={popover} aria-haspopup="dialog" disabled={restoring !== null}>Recover drafts</Button>
      <Popover id={popover} anchor={anchor} width={540} label="Recover drafts" onOpen={() => setOpen(true)} onClose={() => setOpen(false)}>
        <PopoverHead title="Recover drafts" />
        {open ? <DraftList restoring={restoring} onRestoring={setRestoring} /> : null}
      </Popover>
    </>
  );
}
