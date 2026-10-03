"use client";

import { useCallback, useEffect, useState } from "react";
import { deleteDraft, loadDraftHeads, type DraftHead } from "@/io/storage";
import { captureAttention, hasAttention, openResource } from "@/workbench/navigation";
import { restoreScenarioDraft, scenarioDraftDiscarded } from "./scenario";
import { restoreTrajectoryDraft, trajectoryDraftDiscarded } from "./trajectory";

export function useDocumentDrafts() {
  const [state, setState] = useState<{ heads: readonly DraftHead[]; loading: boolean; error: string | null }>({ heads: [], loading: true, error: null });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setState((state) => ({ ...state, loading: true, error: null }));
    void loadDraftHeads().then((heads) => { if (current) setState({ heads, loading: false, error: null }); }, (error: unknown) => { if (current) setState((state) => ({ ...state, loading: false, error: error instanceof Error ? error.message : String(error) })); });
    return () => { current = false; };
  }, [revision]);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  return { ...state, refresh };
}

export async function restoreDocumentDraft(head: DraftHead): Promise<void> {
  const attention = captureAttention();
  if (head.kind === "scenario") await restoreScenarioDraft(head); else await restoreTrajectoryDraft(head);
  if (hasAttention(attention)) openResource({ kind: head.kind, id: head.resourceId });
}

export async function discardDocumentDraft(head: DraftHead): Promise<void> {
  await deleteDraft(head.id, head.revision);
  if (head.kind === "scenario") scenarioDraftDiscarded(head); else trajectoryDraftDiscarded(head);
}
