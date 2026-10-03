import { cancelConfirmation, feedback, requestConfirmation } from "@/workbench/feedback";
import { page } from "@/workbench/navigation/state";
import type { Route } from "@/workbench/navigation/route";
import { peekScenario, releaseScenario } from "./scenario/collection";
import { peekTrajectory, releaseTrajectory } from "./trajectory/collection";
import { saveDocument } from "./versions";

export function confirmDocumentLeave(current: Route, next: Route, leave: () => void): boolean {
  if (current.workspace !== "resource" || (current.kind !== "scenario" && current.kind !== "trajectory")) return true;
  if (next.workspace === "resource" && next.kind === current.kind && next.id === current.id) {
    const confirmation = feedback.get().confirmation;
    if (confirmation?.id === `confirmation:leave:${current.kind}:${current.id}`) cancelConfirmation(confirmation.id, confirmation.version);
    return true;
  }
  const peek = current.kind === "scenario" ? peekScenario : peekTrajectory;
  const doc = peek(current.id);
  if (doc === undefined || !doc.hasUnsavedChanges) return true;
  if (feedback.get().confirmation?.id === `confirmation:leave:${current.kind}:${current.id}`) return false;
  let departureRoute = current;
  const active = () => page.get().route === departureRoute && peek(current.id) === doc;
  requestConfirmation({
    id: `leave:${current.kind}:${current.id}`, scope: doc.name,
    title: "Unsaved changes", message: "Save your changes before leaving, or discard them.",
    confirmLabel: "Save and leave",
    confirm: async () => {
      if (!active()) return;
      const saved = await saveDocument(doc);
      if (saved === null) {
        const route = page.get().route;
        if (route.workspace !== "resource" || route.kind !== current.kind || route.id !== current.id || peek(current.id) !== doc) return;
        departureRoute = route;
        return "Could not save. Fix the reported problem, or choose Discard and leave.";
      }
      if (!active()) return;
      if (doc.hasUnsavedChanges) return "More changes remain. Save again, or choose Discard and leave.";
      leave();
    },
    alternative: {
      label: "Discard and leave",
      run: async () => {
        await doc.saved.settled();
        if (!active()) return;
        (current.kind === "scenario" ? releaseScenario : releaseTrajectory)(current.id);
        leave();
      },
    },
  });
  return false;
}
