import { flushSync } from "react-dom";
import { diagnosticRange, pathKey, jsonPath, type DocumentDiagnostic } from "@/model/document";
import type { Path } from "@/model/schema";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import { documentView, navigate, noteInteraction, page, sectionOf } from "@/workbench/navigation";
import { focusRange } from "@/page/shared/documents/editor";

export function gotoDiagnostic(doc: ScenarioDoc, d: DocumentDiagnostic): void {
  if (documentView(page.get().route) === "json" || (!d.source && (d.line ?? 0) > 0)) {
    flushSync(() => navigate({ workspace: "resource", kind: "scenario", id: doc.id, tab: sectionOf(d), view: "json" }, { history: "replace" }));
    focusRange(doc.editor, diagnosticRange(doc.editor, d).from);
    noteInteraction();
    return;
  }
  gotoScenarioPath(doc, jsonPath(d.path));
}

export function gotoScenarioPath(doc: ScenarioDoc, path: Path): void {
  flushSync(() => {
    doc.editing.revealCollection(path);
    navigate({ workspace: "resource", kind: "scenario", id: doc.id, tab: sectionOf({ path: String(path[0] ?? "") }), view: "form" }, { history: "replace" });
  });
  const pane = document.getElementById("editor-pane");
  if (pane === null) return;
  let el: HTMLElement | null = null;
  for (let key = pathKey(doc.kind, path); el === null; ) {
    el = pane.querySelector<HTMLElement>(`[data-path="${CSS.escape(key)}"]`);
    const up = key.replace(/(\.[^.[\]]+|\[\d+\])$/, "");
    if (up === key) break;
    key = up;
  }
  const target = el ?? pane;
  for (let ancestor: HTMLElement | null = target; ancestor !== null && ancestor !== pane; ancestor = ancestor.parentElement) {
    if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
  }
  target.scrollIntoView({ block: "center" });
  target.querySelector<HTMLElement>("input,button,select,textarea")?.focus({ preventScroll: true });
  noteInteraction();
}
