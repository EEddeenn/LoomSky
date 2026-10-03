import { createStore } from "@/core";
import { parseError, type Prepared } from "@/model/document";
import {
  applyPlanCommand, createPlanRule, freshPlanId, planFrom, selectionExists, type Plan, type PlanCommand, type PlanEditMode, type PlanEntityKind,
  type PlanPosition, type PlanQuantity, type PlanScope, type PlanValue, type Track,
} from "@/model/trajectory";
import type { TrajectoryDoc } from "@/workbench/documents/trajectory";
import { EditingSession } from "../../editing";
import type { EditOutcome, Selection, Tool } from "./types";

type Baseline = Readonly<{ rev: number; source: Plan; track: Track | null; text: string }>;
type Edit =
  | { kind: "idle" }
  | { kind: "gesture"; token: symbol; baseline: Baseline; text: string; candidate: Plan | null; label: string; selection?: Selection; error: string | null };
type GestureStart = { ok: true; token: symbol } | Extract<EditOutcome, { ok: false }>;
type DrawingKind = "bezier" | "polyline" | "circle" | "polygon";
type TimelineQuantity = Extract<PlanQuantity, "speed3d" | "acceleration3d" | "altitude" | "jerk3d">;
type RangeDraft = { range: { from: number; to: number } | null; value: string; authored: boolean; duration: number; error: string | null };
type TrajectorySessionState = {
  selected: Selection; panel: "objects" | "properties" | null; tool: Tool; dragMode: PlanEditMode; edit: Edit;
  curveType: "bezier" | "polyline"; regionType: "circle" | "polygon";
  drawings: Record<DrawingKind, readonly PlanPosition[]>;
  drawingRedo: Record<DrawingKind, readonly PlanPosition[]>;
  drawingErrors: Partial<Record<DrawingKind, string>>;
  timeline: { quantity: TimelineQuantity; ranges: Partial<Record<TimelineQuantity, RangeDraft>> };
};
const emptyDrawing: readonly PlanPosition[] = [];
const emptyRange: RangeDraft = { range: null, value: "", authored: false, duration: Infinity, error: null };
const success: EditOutcome = { ok: true };
const blocked = (message: string): Extract<EditOutcome, { ok: false }> => ({ ok: false, message, level: "warning" });
const entityKinds: readonly PlanEntityKind[] = ["point", "curve", "region", "event", "section", "rule"];
const drawingKinds: readonly DrawingKind[] = ["bezier", "polyline", "circle", "polygon"];
const quantityLabels: Record<TimelineQuantity, string> = { speed3d: "Speed", acceleration3d: "Acceleration", altitude: "Altitude", jerk3d: "Jerk" };
const rounded = (value: number) => Math.round(value * 100) / 100;
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
    drawingErrors: {},
    timeline: { quantity: "speed3d", ranges: {} },
  });

  constructor(doc: TrajectoryDoc) { super(doc.editor); this.trajectory = doc; }

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
      drawingErrors: {},
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
      drawingErrors: { ...state.drawingErrors, [kind]: undefined },
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
  get drawingIssue(): string | null { return this.drawingKind === null ? null : this.get().drawingErrors[this.drawingKind] ?? null; }

  setCurveType(curveType: TrajectorySessionState["curveType"]): void { this.leaveView(); this.editorState.set({ curveType }); }
  setRegionType(regionType: TrajectorySessionState["regionType"]): void { this.leaveView(); this.editorState.set({ regionType }); }

  appendDrawing(position: PlanPosition): void {
    const kind = this.drawingKind;
    if (kind === null || !this.trajectory.editor.writable()) return;
    const start = this.drawing[0];
    this.editorState.set((state) => ({
      drawings: { ...state.drawings, [kind]: (kind === "bezier" || kind === "circle") && start !== undefined
        ? [start, position] : [...state.drawings[kind], position] },
      drawingRedo: { ...state.drawingRedo, [kind]: [] },
      drawingErrors: { ...state.drawingErrors, [kind]: undefined },
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
      drawingErrors: { ...state.drawingErrors, [kind]: undefined },
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
      drawingErrors: { ...state.drawingErrors, [kind]: undefined },
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

  setRange(range: RangeDraft["range"], value = this.rangeDraft.value, authored = false, duration = this.rangeDraft.duration): void {
    const before = this.rangeDraft;
    if (before.range?.from === range?.from && before.range?.to === range?.to && before.value === value && before.authored === authored && before.duration === duration) return;
    this.editorState.set((state) => ({
      timeline: { ...state.timeline, ranges: { ...state.timeline.ranges, [state.timeline.quantity]: { range, value, authored, duration, error: null } } },
    }));
    if (before.authored || authored) this.changed();
  }

  setRangeValue(value: string, duration = this.rangeDraft.duration): void { this.setRange(this.rangeDraft.range, value, true, duration); }
  clearRange(): void { this.setRange(null, "", false); }

  private drawingCommand(kind: DrawingKind, positions: readonly PlanPosition[]): Prepared<PlanCommand> {
    const message = kind === "polygon" && positions.length < 3 ? "Place at least three corners to save the polygon."
      : kind === "polyline" && positions.length < 2 ? "Place at least two points to save the polyline."
      : kind === "bezier" && positions.length !== 2 ? "Place both endpoints to save the Bézier curve."
      : kind === "circle" && positions.length !== 2 ? "Place the center and radius point to save the circle." : null;
    return message === null ? { ok: true, value: { type: "draw-geometry", kind, positions } }
      : this.drawingFailure(kind, message);
  }

  private drawingFailure(kind: DrawingKind, message: string): Extract<Prepared<never>, { ok: false }> {
    this.editorState.set((state) => ({
      drawingErrors: { ...state.drawingErrors, [kind]: message }, panel: null,
      ...(kind === "bezier" || kind === "polyline" ? { tool: "curve", curveType: kind } : { tool: "region", regionType: kind }),
    }));
    return { ok: false, issue: { kind: "busy", message } };
  }

  private rangeCommand(plan: Plan, quantity: TimelineQuantity, draft: RangeDraft, kind: "hard" | "target"): Prepared<PlanCommand> {
    const from = rounded(Math.min(draft.range?.from ?? NaN, draft.range?.to ?? NaN));
    const to = rounded(Math.max(draft.range?.from ?? NaN, draft.range?.to ?? NaN));
    const value = Number(draft.value);
    const label = quantityLabels[quantity];
    const message = !Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to > draft.duration || to <= from
      ? `Choose a nonempty ${label.toLowerCase()} range${Number.isFinite(draft.duration) ? ` within 0–${draft.duration} s` : ""}.`
      : draft.value.trim() === "" || !Number.isFinite(value) || quantity !== "altitude" && value < 0
        ? `Enter a valid ${quantity === "altitude" ? "" : "nonnegative "}${label.toLowerCase()} value.` : null;
    if (message !== null) return this.rangeFailure(quantity, message);
    const id = freshPlanId(plan, `${label.toLowerCase()}-${kind === "hard" ? "limit" : "target"}`);
    const scope: PlanScope = { timeRange: [from, to] };
    return { ok: true, value: { type: "add-rule", rule: kind === "hard"
      ? { id, kind, quantity, scope, range: { max: value } } : { id, kind, quantity, scope, value } } };
  }

  private rangeFailure(quantity: TimelineQuantity, message: string): Extract<Prepared<never>, { ok: false }> {
    this.editorState.set((state) => ({ timeline: {
      ...state.timeline, quantity, ranges: { ...state.timeline.ranges, [quantity]: { ...(state.timeline.ranges[quantity] ?? emptyRange), error: message } },
    } }));
    return { ok: false, issue: { kind: "busy", message } };
  }

  commitDrawing(kind = this.drawingKind): EditOutcome {
    if (kind === null) return success;
    const command = this.drawingCommand(kind, this.get().drawings[kind]);
    if (!command.ok) return blocked(command.issue.kind === "field" ? command.issue.issue.message : command.issue.message);
    const outcome = this.execute(command.value);
    if (!outcome.ok) { this.drawingFailure(kind, outcome.message); return outcome; }
    this.editorState.set((state) => ({
      drawings: { ...state.drawings, [kind]: [] }, drawingRedo: { ...state.drawingRedo, [kind]: [] },
      drawingErrors: { ...state.drawingErrors, [kind]: undefined }, tool: "select", panel: "properties",
    }));
    this.changed();
    return success;
  }

  commitRange(kind: "hard" | "target" = "hard"): EditOutcome {
    const plan = planFrom(this.trajectory.editor.value([]));
    if (plan === null) return blocked("Fix the plan structure before adding a range rule.");
    const quantity = this.get().timeline.quantity;
    const command = this.rangeCommand(plan, quantity, this.rangeDraft, kind);
    if (!command.ok) return blocked(command.issue.kind === "field" ? command.issue.issue.message : command.issue.message);
    const outcome = this.execute(command.value);
    if (!outcome.ok) { this.rangeFailure(quantity, outcome.message); return outcome; }
    this.clearRange();
    return success;
  }

  preparePending(text: string): Prepared<{ text: string; committed(): void }> {
    const state = this.get();
    const drawings = drawingKinds.filter((kind) => state.drawings[kind].length > 0);
    const ranges = (Object.entries(state.timeline.ranges) as [TimelineQuantity, RangeDraft][]).filter(([, draft]) => draft.authored);
    if (drawings.length === 0 && ranges.length === 0) return { ok: true, value: { text, committed() {} } };
    let plan = parseError(text) === null ? planFrom(JSON.parse(text)) : null;
    if (plan === null) return { ok: false, issue: { kind: "busy", message: "Fix the trajectory JSON before saving drawing or range edits." } };
    let selected = state.selected;
    for (const kind of drawings) {
      const command = this.drawingCommand(kind, state.drawings[kind]);
      if (!command.ok) return command;
      const result = applyPlanCommand(plan, command.value);
      if (!result.ok) return this.drawingFailure(kind, result.message);
      plan = result.plan;
      selected = result.selection ?? selected;
    }
    for (const [quantity, draft] of ranges) {
      const command = this.rangeCommand(plan, quantity, draft, "hard");
      if (!command.ok) return command;
      const result = applyPlanCommand(plan, command.value);
      if (!result.ok) return this.rangeFailure(quantity, result.message);
      plan = result.plan;
      selected = result.selection ?? selected;
    }
    return { ok: true, value: { text: `${JSON.stringify(plan, null, 2)}\n`, committed: () => {
      this.editorState.set((current) => ({
        selected, ...(drawings.length > 0 ? { tool: "select" as const, panel: "properties" as const } : {}),
        drawings: { bezier: [], polyline: [], circle: [], polygon: [] }, drawingRedo: { bezier: [], polyline: [], circle: [], polygon: [] }, drawingErrors: {},
        timeline: { ...current.timeline, ranges: Object.fromEntries(Object.entries(current.timeline.ranges).filter(([, draft]) => !draft.authored)) },
      }));
      this.changed();
    } } };
  }

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
