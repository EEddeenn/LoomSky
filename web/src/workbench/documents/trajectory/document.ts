import { invertedEffects, isolateHistory, undoDepth, redoDepth } from "@codemirror/commands";
import { StateEffect, StateField } from "@codemirror/state";
import { commitFieldInputs, prepareFieldInputs, publishFieldChanges } from "@/workbench/documents/editing";
import { writeTransaction, type PendingIssue, type Prepared } from "@/model/document";
import { createStore } from "@/core";
import { compute } from "@/io/compute";
import { appendSavedVersion } from "@/io/storage";
import { resourceSummary, type ResourceHead, type SavedResource, type SavedVersion, type TrajectorySavedVersion } from "@/model/version";
import type { GeneratedTrack, Track, TrajectorySource } from "@/model/trajectory";
import { SavedWorkingCopy, savedHistory } from "../saved";
import { DocumentEditor } from "../editing/session";
import { TrajectoryEvaluation, type TrajectoryRecovery } from "./evaluation";
import { TrajectorySession } from "./editing";

const setTrajectoryName = StateEffect.define<string>();
const trajectoryName = StateField.define<string>({
  create: () => "",
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setTrajectoryName)) value = effect.value;
    return value;
  },
});
const trajectoryNameHistory = invertedEffects.of((transaction) => transaction.effects.some((effect) => effect.is(setTrajectoryName))
  ? [setTrajectoryName.of(transaction.startState.field(trajectoryName))]
  : []);
export class TrajectoryDoc {
  readonly id: string;
  readonly created: number;
  readonly kind = "trajectory";
  readonly editor: DocumentEditor;
  readonly editing: TrajectorySession;
  readonly saved: SavedWorkingCopy<TrajectorySavedVersion>;
  view: TrajectoryEvaluation | null = null;
  private recovery: TrajectoryRecovery = { successful: null };
  private sequence = 0;
  private changeSequence = 0;
  private summaryCache: { rev: number; value: ReturnType<typeof resourceSummary> } | null = null;
  private lifetime: "active" | "deleting" | "disposed" = "active";
  private readonly changes = createStore({});
  private readonly unsubscribeInputs: () => void;

  constructor({ head, version }: SavedResource<"trajectory">) {
    this.id = head.id;
    this.created = head.created;
    this.editor = new DocumentEditor({
      id: this.id, kind: this.kind, text: version.snapshot.source.text,
      extensions: [trajectoryName.init(() => version.snapshot.name), trajectoryNameHistory, savedHistory],
      writable: () => this.lifetime === "active", subscribe: (listener) => this.subscribe(listener),
      significant: (before, after) => before.field(trajectoryName) !== after.field(trajectoryName),
      changed: () => { this.edited(); this.editing.reconcile(); },
    });
    this.saved = new SavedWorkingCopy({ head, version }, {
      snapshot: () => this.workingSnapshot, state: () => this.editor.state(), publish: (transaction) => this.editor.publishTransaction(transaction),
      notify: () => this.touch(), append: (snapshot, origin) => appendSavedVersion({
        kind: this.kind, resourceId: this.id, snapshot, restoredFrom: origin,
      }),
    });
    this.editing = new TrajectorySession(this);
    this.unsubscribeInputs = this.editing.subscribeInputs(() => { this.sequence++; this.touch(); });
  }

  get workingSequence(): number { return this.sequence; }
  get changeVersion(): number { return this.changeSequence; }
  get name(): string { return this.editor.state().field(trajectoryName); }
  get source(): TrajectorySource { return { text: this.editor.text() }; }
  get pending(): boolean { return this.editing.pending; }
  get hasUnsavedChanges(): boolean { return this.saved.dirty || this.pending; }
  get canAdoptExternal(): boolean { return !this.hasUnsavedChanges && !this.editing.busy && !this.saved.saving
    && undoDepth(this.editor.state()) === 0 && redoDepth(this.editor.state()) === 0
    && !Object.values(this.editing.get().drawingRedo).some((positions) => positions.length > 0); }
  get workingSnapshot(): TrajectorySavedVersion["snapshot"] { return { name: this.name, source: this.source }; }
  get summary() {
    if (this.summaryCache?.rev !== this.editor.rev) this.summaryCache = { rev: this.editor.rev, value: resourceSummary(this.kind, this.workingSnapshot) };
    return this.summaryCache.value;
  }
  subscribe(listener: () => void): () => void { return this.changes.subscribe(listener); }
  initialize(): Promise<void> { return Promise.resolve(); }

  attachView(): () => void {
    if (this.view !== null) throw new Error("This document already has an editing view");
    const view = new TrajectoryEvaluation({ revision: () => this.editor.rev, text: () => this.editor.text(), active: () => this.editor.writable() }, () => {
      if (this.view !== view) return;
      this.editor.status = view.status;
      this.editor.diagnostics = view.diagnostics;
      this.touch();
    });
    this.view = view;
    view.restoreRecovery(this.recovery);
    view.resume();
    this.touch();
    return () => {
      if (this.view !== view) return;
      this.editing.leaveView();
      this.recovery = view.checkpoint();
      this.view = null;
      view.dispose();
      this.touch();
    };
  }

  restore(version: SavedVersion, resource?: SavedResource): void {
    if (version.kind !== "trajectory" || resource !== undefined && resource.version.kind !== "trajectory") throw new Error("Choose a saved trajectory version");
    if (this.lifetime !== "active") throw new Error("The trajectory is no longer editable");
    this.saved.restore(version, resource as SavedResource<"trajectory"> | undefined, (effect) => {
      const transaction = this.editor.prepareTransaction({
        changes: { from: 0, to: this.editor.text().length, insert: version.snapshot.source.text },
        effects: [setTrajectoryName.of(version.snapshot.name), effect],
        userEvent: "input.restore", annotations: isolateHistory.of("full"),
      });
      if (transaction === null) return;
      this.editing.reset();
      this.editor.publishTransaction(transaction);
    });
  }

  reconcile(head: ResourceHead | null, version?: SavedVersion): void {
    if (this.lifetime !== "active") return;
    this.saved.observe(head);
    if (head?.kind !== "trajectory" || head.revision !== this.saved.observedHead?.revision || version?.kind !== "trajectory" || version.id !== head.headVersionId
      || !this.canAdoptExternal) return;
    if (this.saved.version.id !== version.id) this.reloadSaved({ head, version });
  }

  reloadSaved(resource: SavedResource): void {
    if (resource.version.kind !== "trajectory" || resource.head.kind !== "trajectory") throw new Error("Choose a saved trajectory version");
    if (this.lifetime !== "active") throw new Error("The trajectory is no longer editable");
    const snapshot = resource.version.snapshot;
    this.saved.adopt(resource as SavedResource<"trajectory">, () => {
      this.editing.reset();
      this.editor.reset(snapshot.source.text, [trajectoryName.init(() => snapshot.name), trajectoryNameHistory, savedHistory]);
      this.edited();
    });
  }

  commitNameDraft(): boolean {
    const name = this.editing.nameDraft?.trim() ?? null;
    if (name === null) return true;
    if (!this.editor.writable() || this.editing.nameIssue !== null) return false;
    this.editing.clearNameDraft();
    if (name !== this.name) this.editor.apply({ effects: setTrajectoryName.of(name), userEvent: "input.form", annotations: isolateHistory.of("full") });
    return true;
  }

  commitFieldInputs(): PendingIssue | null {
    if (!this.editor.writable()) throw new Error("The trajectory is no longer editable");
    const name = this.editing.nameDraft?.trim() ?? null;
    const issue = this.editing.nameIssue;
    if (issue !== null) return { kind: "name", message: issue };
    return commitFieldInputs(this.editor, name !== null && name !== this.name ? { effects: setTrajectoryName.of(name) } : {}, () => this.editing.clearNameDraft());
  }

  prepareSnapshot(): PendingIssue | null {
    if (this.editing.busy) return { kind: "busy", message: "Finish or cancel the current edit before saving or using this document." };
    const name = this.editing.nameDraft?.trim() ?? null;
    const nameIssue = this.editing.nameIssue;
    if (nameIssue !== null) return { kind: "name", message: nameIssue };
    const fields = prepareFieldInputs(this.editor);
    if (!fields.ok) return fields.issue;
    let text = this.editor.text();
    try {
      const inputs = writeTransaction(text, fields.value);
      if (inputs !== null) text = this.editor.state().update(inputs).newDoc.toString();
    } catch (error) {
      return { kind: "busy", message: `Could not apply input: ${error instanceof Error ? error.message : String(error)}` };
    }
    const pending = this.editing.preparePending(text);
    if (!pending.ok) return pending.issue;
    return commitFieldInputs(this.editor, {
      ...(pending.value.text !== this.editor.text() ? { changes: { from: 0, to: this.editor.text().length, insert: pending.value.text } } : {}),
      ...(name !== null && name !== this.name ? { effects: setTrajectoryName.of(name) } : {}),
    }, () => { this.editing.clearNameDraft(); pending.value.committed(); });
  }

  preview(text: string, baselineRev: number): Promise<Track | null> {
    return this.view?.preview(text, baselineRev) ?? Promise.resolve(null);
  }

  cancelPreview(): void { this.view?.cancelPreview(); }

  commitPreview(text: string, baselineRev: number): boolean {
    if (!this.editor.writable() || this.editor.rev !== baselineRev) {
      this.cancelPreview();
      return false;
    }
    if (text === this.editor.text()) {
      this.cancelPreview();
      return true;
    }
    if (this.view === null) return false;
    this.view.commitPreview(text, baselineRev, () => publishFieldChanges(this.editor, this.editor.prepareTransaction({
      changes: { from: 0, to: this.editor.text().length, insert: text },
      userEvent: "input.form", annotations: isolateHistory.of("full"),
    })));
    return true;
  }

  private touch(): void { this.changeSequence++; this.changes.set({}); }
  private edited(): void {
    this.sequence++;
    this.saved.edited();
    if (this.view === null) this.editor.clearEvaluation();
    this.view?.edited();
    this.touch();
  }

  async save(): Promise<Prepared<TrajectorySavedVersion>> {
    const issue = this.prepareSnapshot();
    return issue === null ? { ok: true, value: await this.saved.save() } : { ok: false, issue };
  }

  async prepare(): Promise<Prepared<GeneratedTrack>> {
    const issue = this.prepareSnapshot();
    if (issue !== null) return { ok: false, issue };
    const sequence = this.sequence;
    const track = this.view?.verified ?? (await compute.traj.solve(this.editor.text(), { priority: "action" })).value;
    if (!this.editor.writable() || this.sequence !== sequence) throw new Error("The trajectory changed while it was being checked. Try again.");
    if (track.pht === null || track.diagnostics.some((diagnostic) => diagnostic.error)) throw new Error("Fix the trajectory errors before continuing");
    return { ok: true, value: track as GeneratedTrack };
  }

  dispose(): void {
    this.editing.leaveView();
    this.lifetime = "disposed";
    const view = this.view;
    this.view = null;
    view?.dispose();
    this.editor.clearEvaluation();
    this.unsubscribeInputs();
  }

  async remove(commit: () => Promise<void>): Promise<void> {
    if (!this.editor.writable()) throw new Error("The trajectory is no longer editable");
    this.editing.leaveView();
    this.lifetime = "deleting";
    this.view?.suspend();
    try { await this.saved.settled(); await commit(); this.dispose(); }
    catch (error) { this.lifetime = "active"; this.view?.resume(); this.touch(); throw error; }
  }
}
