import { createStore, randomId } from "@/core";
import type { DocumentDiagnostic, DraftIssue } from "@/model/document";
import type { CommandDraft } from "@/model/host";
import type { Path } from "@/model/schema";
import type { Route } from "./route";
import { noteInteraction } from "./attention";

type FieldTarget = { kind: "diagnostic"; diagnostic: DocumentDiagnostic } | { kind: "field"; issue: DraftIssue };
export type DocumentTarget =
  | { kind: "scenario"; id: string; target: FieldTarget | { kind: "path"; path: Path } }
  | { kind: "trajectory"; id: string; target: FieldTarget | { kind: "name" } };
export type DocumentFocus = DocumentTarget & { requestId: number; visitId: number };
type CommandForm = CommandDraft & { focus: number };
export type ScenarioPreviewView = "map" | "sky" | "effective";
type ScenarioPreviewState = {
  view: ScenarioPreviewView;
  visible: boolean;
  width: number;
};
export type Page = {
  route: Route;
  entryId: string;
  visitId: number;
  instance: string | null;
  documentFocus: DocumentFocus | null;
  lastScenario: string | null;
  rows: Record<string, boolean>;
  activity: { open: boolean; tab: "problems" | "events" };
  command: CommandForm;
  scenarioPreview: ScenarioPreviewState;
};

export const defaultCommand = (): CommandForm => ({ kind: "power", system: "GPS", svid: "", value: "", unit: "dbhz", noise: "", mask: "", focus: 0 });
export const defaultScenarioPreview = (): ScenarioPreviewState => ({ view: "map", visible: true, width: 440 });
const state = createStore<Page>({
  route: { workspace: "home" }, entryId: randomId(), visitId: 0, instance: null,
  documentFocus: null, lastScenario: null,
  rows: {}, activity: { open: false, tab: "problems" },
  command: defaultCommand(), scenarioPreview: defaultScenarioPreview(),
});
export const page = { get: state.get, subscribe: state.subscribe };

export function publishPage(patch: Partial<Page>): void {
  state.set(patch);
}

export function setRows(key: string, open: boolean): void {
  const current = state.get();
  if (current.rows[key] !== open) publishPage({ rows: { ...current.rows, [key]: open } });
}

export function setCommand(patch: Partial<CommandForm>): void {
  publishPage({ command: { ...state.get().command, ...patch } });
}

export function setScenarioPreview(patch: Partial<ScenarioPreviewState>): void {
  publishPage({ scenarioPreview: { ...state.get().scenarioPreview, ...(patch.view === undefined ? {} : { visible: true }), ...patch } });
}

export function setActivity(patch: Partial<Page["activity"]>): void {
  noteInteraction();
  publishPage({ activity: { ...state.get().activity, ...patch } });
}

export function consumeDocumentFocus(focus: DocumentFocus): boolean {
  if (state.get().documentFocus !== focus || state.get().visitId !== focus.visitId) return false;
  noteInteraction();
  publishPage({ documentFocus: null });
  return true;
}
