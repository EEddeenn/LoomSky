import { createStore } from "@/core";
import {
  applyPlanCommand, createPlanRule, freshPlanId, planFrom, selectionExists, type Plan, type PlanCommand, type PlanEditMode, type PlanEntityKind,
  type PlanPosition, type PlanQuantity, type PlanScope, type PlanValue, type Track,
} from "@/model/trajectory";
import type { TrajectoryDoc } from "@/workbench/documents/trajectory";
import { EditingSession } from "../../editing";
import type { EditingCheckpoint } from "../../editing/session";
import type { EditOutcome, Selection, Tool } from "./types";

type Baseline = Readonly<{ rev: number; source: Plan; track: Track | null; text: string }>;
type Edit =
  | { kind: "idle" }
  | { kind: "gesture"; token: symbol; baseline: Baseline; text: string; candidate: Plan | null; label: string; selection?: Selection; error: string | null };
type GestureStart = { ok: true; token: symbol } | Extract<EditOutcome, { ok: false }>;
type DrawingKind = "bezier" | "polyline" | "circle" | "polygon";
type TimelineQuantity = Extract<PlanQuantity, "speed3d" | "acceleration3d" | "altitude" | "jerk3d">;
type RangeDraft = { range: { from: number; to: number } | null; value: string; authored: boolean };
type TrajectorySessionState = {
  selected: Selection; panel: "objects" | "properties" | null; tool: Tool; dragMode: PlanEditMode; edit: Edit;
  curveType: "bezier" | "polyline"; regionType: "circle" | "polygon";
  drawings: Record<DrawingKind, readonly PlanPosition[]>;
  drawingRedo: Record<DrawingKind, readonly PlanPosition[]>;
  timeline: { quantity: TimelineQuantity; ranges: Partial<Record<TimelineQuantity, RangeDraft>> };
};
export type TrajectoryEditingCheckpoint = EditingCheckpoint & Readonly<{
  pendingName: string | null;
  nameBase: string | null;
  state: Omit<TrajectorySessionState, "edit">;
}>;
const emptyDrawing: readonly PlanPosition[] = [];
const emptyRange: RangeDraft = { range: null, value: "", authored: false };
const success: EditOutcome = { ok: true };
const blocked = (message: string): Extract<EditOutcome, { ok: false }> => ({ ok: false, message, level: "warning" });
const entityKinds: readonly PlanEntityKind[] = ["point", "curve", "region", "event", "section", "rule"];
const timelineQuantity = (quantity: PlanQuantity): TimelineQuantity | null =>
  quantity === "speed3d" || quantity === "acceleration3d" || quantity === "altitude" || quantity === "jerk3d" ? quantity : null;

export class TrajectorySession extends EditingSession {
  private readonly trajectory: TrajectoryDoc;
  private pendingName: string | null = null;
  private nameBase: string | null = null;
  private pointerCancel: (() => void) | null = null;
  private readonly editorState = createStore<TrajectorySessionState>({
    selected: null, panel: "objects", tool: "select", dragMode: "target", edit: { kind: "idle" },
    curveType: "bezier", regionType: "circle", drawings: { bezier: [], polyline: [], circle: [], polygon: [] },
    drawingRedo: { bezier: [], polyline: [], circle: [], polygon: [] },
    timeline: { quantity: "speed3d", ranges: {} },
  });

  constructor(doc: TrajectoryDoc) { super(doc.editor); this.trajectory = doc; }

  override checkpoint(): TrajectoryEditingCheckpoint {
    this.leaveView();
    const { edit: _edit, ...state } = this.get();
    return structuredClone({ ...super.checkpoint(), pendingName: this.pendingName, nameBase: this.nameBase, state });
  }

  override restoreCheckpoint(checkpoint: TrajectoryEditingCheckpoint): void {
    this.leaveView();
    const saved = structuredClone(checkpoint);
    this.pendingName = saved.pendingName;
    this.nameBase = saved.nameBase;
    this.editorState.set({ ...saved.state, edit: { kind: "idle" } });
    super.restoreCheckpoint(saved);
  }
  get = () => this.editorState.get();
  subscribe = (listener: () => void) => this.editorState.subscribe(listener);

  override get busy(): boolean { return this.get().edit.kind !== "idle"; }
  override get pending(): boolean { return super.pending || this.pendingName !== null; }
  get nameDraft(): string | null { return this.pendingName; }
  get nameIssue(): string | null {
    if (this.pendingName === null) return null;
    if (this.pendingName.trim() === "") return "Enter a name or revert the draft.";
    return this.nameBase === this.trajectory.name ? null : "The trajectory name changed. Review or revert this draft.";
  }

  setNameDraft(name: string): void {
    if (!this.trajectory.editor.writable()) return;
    const pending = name === this.trajectory.name ? null : name;
    if (pending === this.pendingName) return;
    if (pending === null) this.nameBase = null;
    else if (this.pendingName === null) this.nameBase = this.trajectory.name;
    this.pendingName = pending;
    this.changed();
  }

  clearNameDraft(): void {
    if (this.pendingName === null) return;
    this.pendingName = null;
    this.nameBase = null;
    this.changed();
  }
  override get unapplied(): boolean {
    const state = this.get();
    return state.edit.kind === "gesture" && state.edit.candidate !== null
      || Object.values(state.drawings).some((positions) => positions.length > 0)
      || Object.values(state.timeline.ranges).some((draft) => draft.authored);
  }

  override reconcile(): void {
    super.reconcile();
    const state = this.get();
    if (state.edit.kind !== "idle" && !this.current(state.edit.baseline)) this.cancel();
    const plan = planFrom(this.trajectory.editor.value([]));
    if (plan !== null && !selectionExists(plan, state.selected)) this.editorState.set({ selected: null });
  }

  captureInteraction(cancel: () => void): () => void {
    this.cancelPointer();
    this.pointerCancel = cancel;
    return () => { if (this.pointerCancel === cancel) this.pointerCancel = null; };
  }

  private cancelPointer(): boolean {
    const cancel = this.pointerCancel;
    if (cancel === null) return false;
    this.pointerCancel = null;
    cancel();
    return true;
  }

  override leaveView(): void { this.cancelPointer(); this.cancel(); }

  override reset(): void {
    this.leaveView();
    const pending = this.unapplied;
    this.editorState.set({
      selected: null, tool: "select", drawings: { bezier: [], polyline: [], circle: [], polygon: [] },
      drawingRedo: { bezier: [], polyline: [], circle: [], polygon: [] },
      timeline: { quantity: this.get().timeline.quantity, ranges: {} },
    });
    if (pending) this.changed();
    this.clearNameDraft();
    super.reset();
  }

  override cancelInteraction(): boolean {
    if (this.cancelPointer()) return true;
    if (this.busy) { this.cancel(); return true; }
    if (this.clearDrawing()) return true;
    if (this.rangeDraft.range !== null || this.rangeDraft.value !== "") { this.clearRange(); return true; }
    if (this.get().tool !== "select") { this.setTool("select"); return true; }
    return false;
  }

  override handleHistory(direction: "undo" | "redo"): boolean {
    if (this.cancelPointer()) return true;
    if (this.busy) { this.cancel(); return true; }
    const kind = this.drawingKind;
    if (kind === null) return false;
    if (direction === "undo") return this.popDrawing();
    const positions = this.get().drawingRedo[kind];
    const position = positions.at(-1);
    if (position === undefined) return this.drawing.length > 0;
    this.editorState.set((state) => ({
      drawings: { ...state.drawings, [kind]: [...state.drawings[kind], position] },
      drawingRedo: { ...state.drawingRedo, [kind]: positions.slice(0, -1) },
    }));
    this.changed();
    return true;
  }

  get drawingKind(): DrawingKind | null {
    const state = this.get();
    return state.tool === "curve" ? state.curveType : state.tool === "region" ? state.regionType : null;
  }

  get drawing(): readonly PlanPosition[] {
    const kind = this.drawingKind;
    return kind === null ? emptyDrawing : this.get().drawings[kind];
  }

  setCurveType(curveType: TrajectorySessionState["curveType"]): void { this.leaveView(); this.editorState.set({ curveType }); }
  setRegionType(regionType: TrajectorySessionState["regionType"]): void { this.leaveView(); this.editorState.set({ regionType }); }

  appendDrawing(position: PlanPosition): void {
    const kind = this.drawingKind;
    if (kind === null || !this.trajectory.editor.writable()) return;
    this.editorState.set((state) => ({
      drawings: { ...state.drawings, [kind]: [...state.drawings[kind], position] },
      drawingRedo: { ...state.drawingRedo, [kind]: [] },
    }));
    this.changed();
  }

  popDrawing(): boolean {
    const kind = this.drawingKind;
    const position = this.drawing.at(-1);
    if (kind === null || position === undefined) return false;
    this.editorState.set((state) => ({
      drawings: { ...state.drawings, [kind]: state.drawings[kind].slice(0, -1) },
      drawingRedo: { ...state.drawingRedo, [kind]: [...state.drawingRedo[kind], position] },
    }));
    this.changed();
    return true;
  }

  clearDrawing(): boolean {
    const kind = this.drawingKind;
    if (kind === null || this.drawing.length === 0) return false;
    this.editorState.set((state) => ({
      drawings: { ...state.drawings, [kind]: [] },
      drawingRedo: { ...state.drawingRedo, [kind]: [] },
    }));
    this.changed();
    return true;
  }

  get rangeDraft(): RangeDraft { return this.get().timeline.ranges[this.get().timeline.quantity] ?? emptyRange; }

  setQuantity(quantity: TimelineQuantity): void {
    if (quantity === this.get().timeline.quantity) return;
    this.cancelPointer();
    this.editorState.set((state) => ({ timeline: { ...state.timeline, quantity } }));
  }

  setRange(range: RangeDraft["range"], value = this.rangeDraft.value, authored = false): void {
    const before = this.rangeDraft;
    if (before.range?.from === range?.from && before.range?.to === range?.to && before.value === value && before.authored === authored) return;
    this.editorState.set((state) => ({
      timeline: { ...state.timeline, ranges: { ...state.timeline.ranges, [state.timeline.quantity]: { range, value, authored } } },
    }));
    if (before.authored || authored) this.changed();
  }

  setRangeValue(value: string): void { this.setRange(this.rangeDraft.range, value, true); }
  clearRange(): void { this.setRange(null, "", false); }

  select(selected: Selection): void {
    this.leaveView();
    const state = this.get();
    const changed = state.selected?.kind !== selected?.kind || state.selected?.id !== selected?.id;
    const rule = changed && selected?.kind === "rule" ? planFrom(this.trajectory.editor.value([]))?.rules.find((rule) => rule.id === selected.id) : undefined;
    const quantity = rule !== undefined && "quantity" in rule ? timelineQuantity(rule.quantity) : null;
    this.editorState.set({
      selected, ...(changed && selected !== null ? { panel: "properties" } : {}),
      ...(quantity === null ? {} : { timeline: { ...state.timeline, quantity } }),
    });
  }
  showPanel(panel: TrajectorySessionState["panel"]): void { this.editorState.set({ panel }); }
  showInspector(inspector: boolean): void { this.showPanel(inspector ? "properties" : null); }
  setTool(tool: Tool): void { this.leaveView(); this.editorState.set({ tool, ...(tool === "select" ? {} : { panel: null }) }); }
  setDragMode(dragMode: PlanEditMode): void { this.leaveView(); this.editorState.set({ dragMode }); }

  reveal(path: string): void {
    const plan = planFrom(this.trajectory.editor.value([]));
    let selected: Selection = null;
    if (plan !== null) {
      const match = /^(geometry\.)?(points|curves|regions|events|sections|rules)\[(\d+)\]/.exec(path);
      if (match !== null) {
        const key = match[2] ?? "";
        const index = Number(match[3]);
        const list = key === "points" ? plan.geometry.points : key === "curves" ? plan.geometry.curves
          : key === "regions" ? plan.geometry.regions : key === "events" ? plan.events : key === "sections" ? plan.sections : plan.rules;
        const entity = list?.[index];
        const kind = entityKinds.find((kind) => `${kind}s` === key);
        if (entity !== undefined && kind !== undefined) selected = { kind, id: entity.id };
      } else {
        const rule = plan.rules.filter((rule) => path === `rules.${rule.id}` || path.startsWith(`rules.${rule.id}.`) || path.startsWith(`rules.${rule.id}[`)).sort((a, b) => b.id.length - a.id.length)[0];
        const event = plan.events.find((event) => path === `initialGuess.eventTimes.${event.id}`);
        const state = /^initialGuess\.states\[(\d+)\]/.exec(path);
        const eventId = event?.id ?? (state === null ? undefined : plan.initialGuess?.states?.[Number(state[1])]?.event);
        if (rule !== undefined) selected = { kind: "rule", id: rule.id };
        else if (eventId !== undefined && plan.events.some((event) => event.id === eventId)) selected = { kind: "event", id: eventId };
      }
    }
    this.select(selected);
    this.showInspector(true);
  }

  owns(token: symbol): boolean {
    const edit = this.get().edit;
    return edit.kind === "gesture" && edit.token === token;
  }

  cancel(token?: symbol): void {
    const edit = this.get().edit;
    if (edit.kind === "idle" || token !== undefined && edit.token !== token) return;
    this.editorState.set({ edit: { kind: "idle" } });
    this.trajectory.cancelPreview();
    this.changed();
  }

  private current(baseline: Baseline): boolean {
    return this.trajectory.editor.writable() && baseline.rev === this.trajectory.editor.rev;
  }

  begin(label = "Edit trajectory"): GestureStart {
    this.leaveView();
    if (!this.trajectory.editor.writable()) return blocked("This trajectory is no longer editable.");
    const pending = this.trajectory.commitFieldInputs();
    if (pending !== null) return {
      ok: false, message: pending.kind === "field" ? pending.issue.message : pending.message,
      level: "warning", issue: pending,
    };
    if (this.trajectory.editor.broken() !== null) return blocked("Fix the trajectory JSON before editing objects.");
    const source = planFrom(this.trajectory.editor.value([]));
    if (source === null) return blocked("Fix the plan structure in JSON before editing objects.");
    const track = this.trajectory.view?.currentShape ?? null;
    const text = this.trajectory.editor.text();
    const baseline: Baseline = { rev: this.trajectory.editor.rev, source: structuredClone(source), track, text };
    const token = Symbol();
    this.editorState.set({ edit: { kind: "gesture", token, baseline, text, candidate: null, label, error: null } });
    this.changed();
    return { ok: true, token };
  }

  previewCommand(token: symbol, command: PlanCommand): EditOutcome {
    return this.applyCommand(token, command, true);
  }

  private applyCommand(token: symbol, command: PlanCommand, preview: boolean): EditOutcome {
    const edit = this.get().edit;
    if (edit.kind !== "gesture" || edit.token !== token) return blocked("This edit is no longer active.");
    if (!this.current(edit.baseline)) {
      this.cancel(token);
      return blocked("The source changed. Try the edit again.");
    }
    const result = applyPlanCommand(edit.baseline.source, command, {
      mode: this.get().dragMode, inspection: edit.baseline.track?.inspection,
    });
    if (!result.ok) {
      this.editorState.set({ edit: { ...edit, error: result.message } });
      return blocked(result.message);
    }
    const unchanged = JSON.stringify(result.plan) === JSON.stringify(edit.baseline.source);
    const text = unchanged ? edit.baseline.text : `${JSON.stringify(result.plan, null, 2)}\n`;
    this.editorState.set({ edit: { ...edit, text, candidate: unchanged ? null : result.plan, selection: result.selection, error: null } });
    if (text !== edit.text) this.changed();
    if (unchanged) this.trajectory.cancelPreview();
    else if (preview && (text !== edit.text || edit.error !== null)) void this.trajectory.preview(text, edit.baseline.rev);
    return success;
  }

  previewTarget(token: symbol, scope: PlanScope, quantity: PlanQuantity, value: PlanValue): EditOutcome {
    return this.previewCommand(token, { type: "target", scope, quantity, value });
  }

  previewPosition(token: symbol, scope: PlanScope, position: PlanPosition): EditOutcome {
    return this.previewCommand(token, { type: "position-target", scope, position });
  }

  commit(token: symbol): EditOutcome {
    const edit = this.get().edit;
    if (edit.kind !== "gesture" || edit.token !== token) return blocked("This edit is no longer active.");
    if (edit.error !== null) {
      this.cancel(token);
      return blocked(edit.error);
    }
    this.editorState.set({ edit: { kind: "idle" } });
    this.changed();
    if (!this.trajectory.commitPreview(edit.text, edit.baseline.rev)) return blocked("The source changed. Try the edit again.");
    if (edit.selection !== undefined) this.select(edit.selection);
    return success;
  }

  execute(command: PlanCommand, label = "Edit trajectory"): EditOutcome {
    const begun = this.begin(label);
    if (!begun.ok) return begun;
    const updated = this.applyCommand(begun.token, command, false);
    if (!updated.ok) { this.cancel(begun.token); return updated; }
    return this.commit(begun.token);
  }

  removeSelected(cascade = false): EditOutcome {
    const selection = this.get().selected;
    return selection === null ? success : this.execute({ type: "remove", selection, cascade }, "Remove trajectory object");
  }

  addStop(eventId: string, duration: number): EditOutcome {
    return this.execute({ type: "add-stop", eventId, duration }, "Add stop");
  }

  addEvent(): EditOutcome {
    const plan = planFrom(this.trajectory.editor.value([]));
    if (plan === null) return blocked("Fix the plan structure before adding an event.");
    const selected = this.get().selected;
    const section = selected?.kind === "section" ? plan.sections.find((item) => item.id === selected.id) : undefined;
    const after = selected?.kind === "event" ? selected.id : section?.from ?? plan.events.at(-2)?.id;
    return this.execute({ type: "add-event", event: { id: freshPlanId(plan, "event") }, ...(after === undefined ? {} : { after }) }, "Add event");
  }

  addRule(): EditOutcome {
    const plan = planFrom(this.trajectory.editor.value([]));
    if (plan === null) return blocked("Fix the trajectory JSON before adding a rule.");
    const rule = createPlanRule(plan, this.get().selected);
    return rule === null ? blocked("Add a point event before creating a rule.") : this.execute({ type: "add-rule", rule });
  }
}
