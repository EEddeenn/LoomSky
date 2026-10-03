import { hasInputHistory } from "@/page/shared/ui";
import { runDocumentHistory } from "@/page/shared/documents/history";
import { saveDocument } from "@/workbench/documents/versions";
import { peekScenario } from "@/workbench/documents/scenario";
import { peekTrajectory } from "@/workbench/documents/trajectory";
import { documentView, page } from "@/workbench/navigation";
import { feedback } from "@/workbench/feedback";

export function startDocumentShortcuts(): () => void {
  const guardPopover = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || !(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key !== "z" && (event.shiftKey || key !== "s" && key !== "y")) return;
    const popover = document.querySelector(":popover-open");
    if (popover === null || key !== "s" && event.target instanceof Node && popover.contains(event.target) && hasInputHistory(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const keyboard = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    const key = event.key.toLowerCase();
    const modified = event.metaKey || event.ctrlKey;
    const save = modified && !event.altKey && !event.shiftKey && key === "s";
    const history = modified && !event.altKey && (key === "z" || key === "y" && !event.shiftKey);
    const cancel = key === "escape" && !modified && !event.altKey && !event.shiftKey;
    if (!save && !history && !cancel) return;
    const route = page.get().route;
    if (route.workspace !== "resource") return;
    const doc = route.kind === "scenario" ? peekScenario(route.id) : route.kind === "trajectory" ? peekTrajectory(route.id) : undefined;
    if (doc === undefined) return;
    const blocked = document.querySelector("dialog[open], :popover-open") !== null || feedback.get().confirmation !== null;
    if (cancel) {
      if (blocked || page.get().activity.open || documentView(page.get().route) !== "form" || !doc.editing.cancelInteraction()) return;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (history && hasInputHistory(event.target)) return;
    event.preventDefault();
    if (blocked) return;
    if (save) {
      void saveDocument(doc);
      return;
    }
    const direction = event.shiftKey || key === "y" ? "redo" : "undo";
    runDocumentHistory(doc, direction, documentView(page.get().route));
  };
  const leave = (event: BeforeUnloadEvent) => {
    const route = page.get().route;
    if (route.workspace !== "resource") return;
    const doc = route.kind === "scenario" ? peekScenario(route.id) : route.kind === "trajectory" ? peekTrajectory(route.id) : undefined;
    if (doc === undefined || !doc.hasUnsavedChanges && doc.saved.state.status !== "saving") return;
    event.preventDefault();
    event.returnValue = "";
  };
  addEventListener("keydown", guardPopover, true);
  addEventListener("keydown", keyboard);
  addEventListener("beforeunload", leave);
  return () => {
    removeEventListener("keydown", guardPopover, true);
    removeEventListener("keydown", keyboard);
    removeEventListener("beforeunload", leave);
  };
}
