import { deleteTrajectory, newTrajectory, type TrajectoryDoc } from "@/workbench/documents/trajectory";
import { captureAttention, type AttentionToken } from "@/workbench/navigation";
import { reportProblem, resolveProblem } from "@/workbench/feedback";
import { startDuplicate, startExport } from "@/workbench/operations";
import { reportPendingIssue } from "../editing";
import { captureOperation, confirmDelete, openCreated } from "../operations";

export async function createTrajectory(): Promise<TrajectoryDoc | null> {
  const attention = captureAttention();
  try {
    const doc = await newTrajectory();
    openCreated(attention, { workspace: "resource", kind: "trajectory", id: doc.id });
    resolveProblem("trajectory-library:create");
    return doc;
  } catch (error) {
    reportProblem({
      id: "trajectory-library:create", level: "error", scope: "Trajectory library", title: "Could not create trajectory",
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function copyTrajectory(doc: TrajectoryDoc, returnScenario?: string, attention: AttentionToken = captureAttention()): Promise<boolean> {
  const input = captureOperation(doc, "duplicate", attention);
  if (input === null) return false;
  const operation = await startDuplicate({ ...input, kind: "trajectory" }).done;
  if (operation.phase !== "succeeded" || operation.result?.kind !== "trajectory") return false;
  openCreated(attention, { workspace: "resource", kind: "trajectory", id: operation.result.id, ...(returnScenario === undefined ? {} : { returnScenario }) });
  return true;
}
export async function removeTrajectory(doc: TrajectoryDoc): Promise<boolean> {
  return confirmDelete(doc, deleteTrajectory);
}
async function download(doc: TrajectoryDoc, kind: "trajectory-json" | "trajectory-pht", attention: AttentionToken): Promise<boolean> {
  const input = captureOperation(doc, "export", attention);
  return input !== null && (await startExport({ ...input, kind }).done).phase === "succeeded";
}
export function downloadTrajectorySource(doc: TrajectoryDoc, attention: AttentionToken = captureAttention()): Promise<boolean> { return download(doc, "trajectory-json", attention); }
export function downloadTrajectoryPht(doc: TrajectoryDoc, attention: AttentionToken = captureAttention()): Promise<boolean> { return download(doc, "trajectory-pht", attention); }
export async function generateTrajectory(doc: TrajectoryDoc): Promise<boolean> {
  const attention = captureAttention();
  const target = { kind: "trajectory" as const, id: doc.id };
  try {
    const issue = doc.prepareSnapshot();
    if (issue !== null) { reportPendingIssue(target, issue, attention); return false; }
    if (doc.view !== null) { await doc.view.refresh("action"); return doc.view?.ready ?? false; }
    return (await doc.prepare()).ok;
  } catch (error) {
    reportProblem({ id: `trajectory:${doc.id}:generate`, level: "error", scope: `Trajectory · ${doc.id}`, title: "Could not solve trajectory", message: error instanceof Error ? error.message : String(error) });
    return false;
  }
}
