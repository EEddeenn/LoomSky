import type { FeedbackLevel } from "@/core";
import { log } from "./feedback/events";
import { feedback } from "./feedback/state";
import type { Confirmation, ConfirmationRecord, Problem, ProblemRecord } from "./feedback/types";
import { closePageSession, isPageSession, setActivity } from "./navigation";

export { announce, clearLog, downloadLog, events, log, type EventKind } from "./feedback/events";
export { feedback } from "./feedback/state";
export type { ConfirmationRecord, Notice, Problem, ProblemRecord } from "./feedback/types";

let messageSequence = 0;
let confirmationVersion = 0;
let releaseOwner: (() => void) | undefined;

export function dismissNotification(id: number): void {
  if (feedback.get().notice?.id === id) feedback.set({ notice: null });
}

function installProblems(problems: readonly ProblemRecord[]): void {
  const selected = feedback.get().selected;
  feedback.set({ problems, selected: selected !== null && problems.some((problem) => problem.id === selected) ? selected : null });
}

export function replaceProblems(owner: string, problems: readonly Problem[]): void {
  const current = feedback.get().problems;
  const prior = new Map(current.map((problem) => [problem.id, problem]));
  const replacements = problems.map((problem): ProblemRecord => ({ ...problem, owner, created: prior.get(problem.id)?.created ?? Date.now() }));
  const ids = new Set(replacements.map((problem) => problem.id));
  installProblems([...current.filter((problem) => problem.owner !== owner && !ids.has(problem.id)), ...replacements]);
}

export function reportProblem(problem: Problem): void {
  const current = feedback.get().problems;
  const before = current.find((item) => item.id === problem.id);
  installProblems([...current.filter((item) => item.id !== problem.id), { ...problem, owner: null, created: before?.created ?? Date.now() }]);
  log(problem.scope, `${problem.title}: ${problem.message}`, problem.level === "error" ? "alarm" : "warn", problem.id);
}

export function resolveProblem(id: string): void {
  if (feedback.get().problems.some((problem) => problem.id === id)) installProblems(feedback.get().problems.filter((problem) => problem.id !== id));
}

export function dismissProblem(id: string): void {
  const problem = feedback.get().problems.find((item) => item.id === id);
  if (problem !== undefined && problem.owner === null && !problem.urgent) resolveProblem(id);
}

export async function runProblemAction(problemId: string, actionId: string): Promise<void> {
  const state = feedback.get();
  const problem = state.problems.find((item) => item.id === problemId);
  const action = problem?.actions?.find((item) => item.id === actionId);
  if (problem === undefined || action === undefined || action.disabled || state.pendingActions.has(problemId)) return;
  const attempt = { actionId };
  feedback.set({ pendingActions: new Map(state.pendingActions).set(problemId, attempt) });
  const failureId = `${problemId}:action:${actionId}`;
  try {
    await action.run();
    if (feedback.get().pendingActions.get(problemId) === attempt) resolveProblem(failureId);
  } catch (error) {
    const current = feedback.get();
    const source = current.problems.find((item) => item.id === problemId);
    if (current.pendingActions.get(problemId) === attempt && source?.created === problem.created && source.owner === problem.owner) reportProblem({
      id: failureId, level: "error", scope: problem.scope,
      title: `${action.label} failed`, message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    const current = feedback.get().pendingActions;
    if (current.get(problemId) === attempt) {
      const pendingActions = new Map(current);
      pendingActions.delete(problemId);
      feedback.set({ pendingActions });
    }
  }
}

export function openProblems(id?: string): void {
  feedback.set((state) => ({ selected: id ?? null, focusVersion: state.focusVersion + 1 }));
  setActivity({ open: true, tab: "problems" });
}

export function toast(message: string, level: FeedbackLevel = "success"): void {
  if (level === "error" || level === "warning") {
    reportProblem({ id: `operation:${level}:${message}`, level, scope: "Operations", title: level === "error" ? "Operation failed" : "Action needs attention", message });
    return;
  }
  feedback.set({ notice: { id: ++messageSequence, level, message } });
  log("", message, level === "success" ? "success" : "notice");
}

export function requestConfirmation(confirmation: Confirmation): boolean {
  if (confirmation.owner !== undefined && !isPageSession(confirmation.owner)) return false;
  const existing = feedback.get().confirmation;
  if (existing !== null) {
    toast(`Confirm or cancel: ${existing.title}`, "info");
    feedback.set({ confirmation: { ...existing } });
    return false;
  }
  const record: ConfirmationRecord = { ...confirmation, id: `confirmation:${confirmation.id}`, version: ++confirmationVersion, pending: false };
  feedback.set({ confirmation: record });
  if (record.owner !== undefined) {
    const owner = record.owner;
    const abort = () => cancelConfirmation(record.id, record.version);
    owner.signal.addEventListener("abort", abort, { once: true });
    releaseOwner = () => owner.signal.removeEventListener("abort", abort);
  }
  log(record.scope, `Confirmation requested: ${record.title}`);
  return true;
}

function releaseConfirmationOwner(record: ConfirmationRecord): void {
  releaseOwner?.();
  releaseOwner = undefined;
  if (record.owner !== undefined) closePageSession(record.owner);
}

function currentConfirmation(id: string, version: number): ConfirmationRecord | null {
  const record = feedback.get().confirmation;
  return record?.id === id && record.version === version ? record : null;
}

function removeConfirmation(record: ConfirmationRecord): boolean {
  if (currentConfirmation(record.id, record.version) === null) return false;
  feedback.set({ confirmation: null });
  releaseConfirmationOwner(record);
  return true;
}

export function cancelConfirmation(id: string, version: number): void {
  const record = currentConfirmation(id, version);
  if (record !== null && !record.pending && removeConfirmation(record)) log(record.scope, `Cancelled: ${record.title}`);
}

export async function confirmConfirmation(id: string, version: number, alternative = false): Promise<void> {
  const record = currentConfirmation(id, version);
  if (record === null || record.pending) return;
  const action = alternative ? record.alternative : { label: record.confirmLabel, run: record.confirm };
  if (action === undefined) return;
  feedback.set({ confirmation: { ...record, pending: true } });
  releaseConfirmationOwner(record);
  log(record.scope, `Confirmed: ${record.title}`, "action");
  try {
    const message = await action.run();
    if (typeof message === "string") {
      const current = currentConfirmation(id, version);
      if (current !== null) feedback.set({ confirmation: { ...current, message, pending: false } });
      return;
    }
    if (removeConfirmation(record)) resolveProblem(`${id}:failure`);
  } catch (error) {
    if (removeConfirmation(record) && !(error instanceof DOMException && error.name === "AbortError")) reportProblem({
      id: `${id}:failure`, level: "error", scope: record.scope,
      title: `${action.label} failed`, message: error instanceof Error ? error.message : String(error),
    });
  }
}
