"use client";

import { useEffect } from "react";
import { useStore } from "@/core";
import { draftDiagnostic, draftProblemId, resolveField } from "@/model/document";
import type { TrajectoryDoc } from "@/workbench/documents/trajectory";
import { documentView, consumeDocumentFocus, page } from "@/workbench/navigation";
import { openProblems } from "@/workbench/feedback";
import { useDocumentView } from "@/workbench/documents/use-document";
import { useEditingView } from "@/page/shared/documents/use-editing-view";
import { TrajectoryCanvas } from "./editor/canvas";
import { gotoTrajectoryDiagnostic } from "./editor/diagnostics";

export function TrajectoryEditor({ doc }: { doc: TrajectoryDoc }) {
  const view = useStore(page, (state) => documentView(state.route));
  const focus = useStore(page, (state) => state.documentFocus);
  useEditingView(doc, view);
  useDocumentView(doc);
  useEffect(() => {
    if (focus === null || focus.kind !== "trajectory" || focus.id !== doc.id) return;
    const frame = requestAnimationFrame(() => {
      if (!consumeDocumentFocus(focus)) return;
      if (focus.target.kind === "name") document.getElementById(`trajectory-name-${doc.id}`)?.focus();
      else if (focus.target.kind === "diagnostic") gotoTrajectoryDiagnostic(doc, focus.target.diagnostic);
      else {
        const issue = focus.target.issue;
        const path = resolveField(doc.editor, issue.ref);
        if (path === null) openProblems(draftProblemId(doc.id, doc.kind, issue.ref));
        else gotoTrajectoryDiagnostic(doc, draftDiagnostic(doc.kind, { ...issue, path }));
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [doc, focus]);
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      aria-label={`Trajectory ${doc.name}`}
    >
      <TrajectoryCanvas doc={doc} view={view} />
    </section>
  );
}
