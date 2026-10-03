import { flushSync } from "react-dom";
import { diagnosticRange, type DocumentDiagnostic } from "@/model/document";
import { documentView, navigate, noteInteraction, page } from "@/workbench/navigation";
import type { TrajectoryDoc } from "@/workbench/documents/trajectory";
import { focusRange } from "@/page/shared/documents/editor";
import { diagnosticKey } from "@/model/document";

export function gotoTrajectoryDiagnostic(doc: TrajectoryDoc, diagnostic: DocumentDiagnostic): void {
  const route = page.get().route;
  const destination = route.workspace === "resource" && route.kind === "trajectory" && route.id === doc.id
    ? route
    : { workspace: "resource" as const, kind: "trajectory" as const, id: doc.id };
  const json = documentView(page.get().route) === "json" || (!diagnostic.source && (diagnostic.line ?? 0) > 0);
  flushSync(() => navigate({ ...destination, view: json ? "json" : "form" }, { history: "replace" }));
  if (json) {
    focusRange(doc.editor, diagnosticRange(doc.editor, diagnostic).from);
    noteInteraction();
    return;
  }
  flushSync(() => doc.editing.reveal(diagnostic.path));
  const pane = document.getElementById("trajectory-inspector");
  const path = diagnosticKey({ ...diagnostic, file: doc.kind });
  let target: HTMLElement | null = null;
  for (const candidate of pane?.querySelectorAll<HTMLElement>("[data-path]") ?? []) {
    const key = candidate.dataset.path;
    if (key !== undefined && (path === key || path.startsWith(`${key}.`) || path.startsWith(`${key}[`)) && key.length >= (target?.dataset.path?.length ?? 0)) target = candidate;
  }
  if (target !== null) {
    const control = target.querySelector<HTMLElement>("input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),summary");
    for (let element: HTMLElement | null = control ?? target; element !== null && element !== pane; element = element.parentElement) {
      if (element instanceof HTMLDetailsElement) element.open = true;
    }
    target.scrollIntoView({ block: "center" });
    control?.focus({ preventScroll: true });
    noteInteraction();
  } else {
    flushSync(() => navigate({ ...destination, view: "json" }, { history: "replace" }));
    focusRange(doc.editor, diagnosticRange(doc.editor, diagnostic).from);
    noteInteraction();
  }
}
