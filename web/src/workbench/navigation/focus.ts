import { draftDiagnostic } from "@/model/document";
import { normalizeRoute, sectionOf, type DocumentView } from "./route";
import { navigateToDocument } from "./routing";
import { page, type DocumentTarget } from "./state";

export function revealDocument(focus: DocumentTarget): void {
  const current = page.get().route;
  const sameDocument = current.workspace === "resource" && current.kind === focus.kind && current.id === focus.id;
  const diagnostic = focus.target.kind === "diagnostic" ? focus.target.diagnostic
    : focus.target.kind === "field" ? draftDiagnostic(focus.kind, focus.target.issue) : null;
  const view: DocumentView = diagnostic !== null && ((!diagnostic.source && (diagnostic.line ?? 0) > 0)
    || sameDocument && "view" in current && current.view === "json") ? "json" : "form";
  if (focus.kind === "scenario") {
    const path = diagnostic ?? { path: focus.target.kind === "path" ? String(focus.target.path[0] ?? "") : "" };
    navigateToDocument({ workspace: "resource", kind: "scenario", id: focus.id, tab: sectionOf(path), view }, focus);
    return;
  }
  const route = sameDocument && current.workspace === "resource" && current.kind === "trajectory"
    ? { ...current, view }
    : normalizeRoute({ workspace: "resource", kind: "trajectory", id: focus.id, view });
  navigateToDocument(route, focus);
}
