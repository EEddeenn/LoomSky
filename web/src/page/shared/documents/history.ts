import { redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import type { TrajectoryDoc } from "@/workbench/documents/trajectory";
import { dispatchDocumentTransaction } from "@/workbench/documents/editing/dispatch";

type HistoryDocument = ScenarioDoc | TrajectoryDoc;
type Direction = "undo" | "redo";
type View = "form" | "json";

export function canDocumentHistory(doc: HistoryDocument, direction: Direction, view: View): boolean {
  if (!doc.editor.writable()) return false;
  if (view === "form" && doc.kind === "trajectory") {
    const editing = doc.editing;
    if (editing.busy) return true;
    const kind = editing.drawingKind;
    if (kind !== null) {
      if (direction === "undo" && editing.drawing.length > 0) return true;
      if (direction === "redo") {
        if (editing.get().drawingRedo[kind].length > 0) return true;
        if (editing.drawing.length > 0) return false;
      }
    }
  }
  return (direction === "undo" ? undoDepth : redoDepth)(doc.editor.state()) > 0;
}

export function runDocumentHistory(doc: HistoryDocument, direction: Direction, view: View): void {
  if (!doc.editor.writable()) return;
  if (view === "form" && doc.editing.handleHistory(direction)) return;
  (direction === "redo" ? redo : undo)({
    state: doc.editor.state(),
    dispatch: (transaction) => {
      if (!dispatchDocumentTransaction(doc.editor, transaction)) doc.editor.accept(transaction.state);
    },
  });
}
