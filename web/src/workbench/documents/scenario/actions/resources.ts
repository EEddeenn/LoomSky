import { openScenario, deleteScenario, newScenario, type NewScenario } from "../collection";
import type { ScenarioDoc } from "../document";
import { captureAttention, hasAttention, revealDocument, type AttentionToken } from "@/workbench/navigation";
import { reportProblem, resolveProblem } from "@/workbench/feedback";
import { startDuplicate, startExport } from "@/workbench/operations";
import { scenarioPreviewSession } from "@/workbench/preview";
import { captureOperation, confirmDelete, openCreated } from "../../operations";
import { chooseScenarioTrajectory } from "./bindings";

export async function createScenario(input: NewScenario): Promise<boolean> {
  const attention = captureAttention();
  try {
    const doc = await newScenario(input);
    if (hasAttention(attention)) revealDocument({ kind: "scenario", id: doc.id, target: { kind: "path", path: ["name"] } });
    resolveProblem("scenario-library:create");
    return true;
  } catch (error) {
    reportProblem({
      id: "scenario-library:create", level: "error", scope: "Scenario library", title: "Could not create scenario",
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function copyScenario(doc: ScenarioDoc, attention: AttentionToken = captureAttention()): Promise<boolean> {
  const input = captureOperation(doc, "duplicate", attention);
  if (input === null) return false;
  const operation = await startDuplicate({ ...input, kind: "scenario" }).done;
  if (operation.phase !== "succeeded" || operation.result?.kind !== "scenario") return false;
  openCreated(attention, { workspace: "resource", kind: "scenario", id: operation.result.id, tab: "setup" });
  return true;
}
export async function removeScenario(doc: ScenarioDoc): Promise<boolean> {
  return confirmDelete(doc, deleteScenario);
}
export async function downloadScenario(doc: ScenarioDoc, attention: AttentionToken = captureAttention()): Promise<boolean> {
  const input = captureOperation(doc, "export", attention);
  return input !== null && (await startExport({ ...input, kind: "scenario" }).done).phase === "succeeded";
}
export async function adoptTrajectory(scenarioId: string, trajectoryId: string): Promise<boolean> {
  const attention = captureAttention();
  const doc = await openScenario(scenarioId);
  if (!hasAttention(attention)) return false;
  chooseScenarioTrajectory(doc, trajectoryId);
  return true;
}

export function canInspectScenarioTime(doc: ScenarioDoc, milliseconds: number | null): boolean {
  return milliseconds !== null && Number.isFinite(milliseconds) && doc.view?.lastSuccessful != null;
}

export function inspectScenarioTime(doc: ScenarioDoc, milliseconds: number | null): void {
  if (!canInspectScenarioTime(doc, milliseconds) || milliseconds === null) return;
  scenarioPreviewSession(doc).seek(milliseconds);
}
