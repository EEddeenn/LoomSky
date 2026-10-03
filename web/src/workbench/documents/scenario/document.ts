import { isolateHistory, undoDepth, redoDepth } from "@codemirror/commands";
import type { TransactionSpec } from "@codemirror/state";
import * as jsonc from "jsonc-parser";
import { createStore, isRecord, listOf, recordOf } from "@/core";
import { gpsInCalendarRange, gpsOfTime, presentLeap, type Leap } from "@/model/gnss";
import { packedLeap, type Window } from "@/model/bundle";
import type { Coverage } from "@/io/pharos";
import { appendSavedVersion } from "@/io/storage";
import { resourceSummary, type ResourceHead, type ResourceSummaryTrajectory, type SavedResource, type SavedVersion, type ScenarioSavedVersion } from "@/model/version";
import type { ArtifactFile } from "@/model/artifact";
import type { TrajectoryRevision } from "@/model/trajectory";
import { writeTransaction, type PendingIssue, type Prepared, type WriteChange } from "@/model/document";
import { commitFieldInputs, prepareFieldInputs, publishFieldChanges } from "../editing";
import { appendCollectionItem, coverageWindow, inputFileName, scenarioBindingHistory, scenarioBindings, scenarioFileReferences, setScenarioBindings, type ScenarioBindings, type ScenarioFileField, type ScenarioFileReference, type ScenarioFileSelection } from "@/model/scenario";
import { systemsOf } from "@/model/schema";
import { schemas } from "@/workbench/schemas";
import { SavedWorkingCopy, savedHistory } from "../saved";
import { DocumentEditor } from "../editing/session";
import { resolveTrajectoryBuild } from "../trajectory/builds";
import { ScenarioEvaluation, type ScenarioRecovery } from "./evaluation";
import { ScenarioSession } from "./editing";

type ScenarioWindow = { startGpsMs: number; durationMs: number; leap: Leap };
type BoundTrajectory = ResourceSummaryTrajectory & { buildId: string; file: ArtifactFile; name: string };

export class ScenarioDoc {
  readonly id: string;
  readonly kind = "scenario";
  readonly created: number;
  readonly editor: DocumentEditor;
  readonly editing: ScenarioSession;
  readonly saved: SavedWorkingCopy<ScenarioSavedVersion>;
  view: ScenarioEvaluation | null = null;
  private recovery: ScenarioRecovery = { successful: null };
  private bound: BoundTrajectory | null = null;
  private summaryCache: { rev: number; bound: BoundTrajectory | null; value: ReturnType<typeof resourceSummary> } | null = null;
  private sequence = 0;
  private changeSequence = 0;
  private lifetime: "active" | "deleting" | "disposed" = "active";
  private readonly changes = createStore({});
  private readonly unsubscribeInputs: () => void;

  constructor({ head, version }: SavedResource<"scenario">) {
    this.id = head.id;
    this.created = head.created;
    this.editor = new DocumentEditor({
      id: this.id, kind: this.kind, text: version.snapshot.source.text,
      extensions: [scenarioBindings.init(() => version.snapshot.bindings), scenarioBindingHistory, savedHistory],
      writable: () => this.lifetime === "active", subscribe: (listener) => this.subscribe(listener),
      significant: (before, after) => before.field(scenarioBindings) !== after.field(scenarioBindings),
      changed: () => { this.edited(); this.editing.reconcile(); },
    });
    this.saved = new SavedWorkingCopy({ head, version }, {
      snapshot: () => this.workingSnapshot, state: () => this.editor.state(), publish: (transaction) => this.editor.publishTransaction(transaction),
      notify: () => this.touch(), append: (snapshot, origin) => appendSavedVersion({
        kind: this.kind, resourceId: this.id, snapshot, restoredFrom: origin,
      }),
    });
    this.editing = new ScenarioSession(this.editor);
    this.unsubscribeInputs = this.editing.subscribeInputs(() => { this.sequence++; this.touch(); });
  }

  get workingSequence(): number { return this.sequence; }
  get changeVersion(): number { return this.changeSequence; }
  get name(): string { const name = this.editor.value(["name"]); return typeof name === "string" && name.trim() !== "" ? name : "Untitled scenario"; }
  get pending(): boolean { return this.editing.pending; }
  get hasUnsavedChanges(): boolean { return this.saved.dirty || this.pending; }
  get canAdoptExternal(): boolean { return !this.hasUnsavedChanges && !this.editing.busy && !this.saved.saving
    && undoDepth(this.editor.state()) === 0 && redoDepth(this.editor.state()) === 0; }
  get workingSnapshot(): ScenarioSavedVersion["snapshot"] { return { source: { text: this.editor.text() }, bindings: this.bindingSnapshot(this.files) }; }
  get summary() {
    if (this.summaryCache?.rev !== this.editor.rev || this.summaryCache.bound !== this.bound) this.summaryCache = {
      rev: this.editor.rev, bound: this.bound,
      value: resourceSummary(this.kind, this.workingSnapshot, this.name, this.bound !== null && this.bound.buildId === this.trajectory?.buildId ? this.bound : undefined),
    };
    return this.summaryCache.value;
  }
  private get bindings(): ScenarioBindings { return this.editor.state().field(scenarioBindings); }
  private get adopted(): TrajectoryRevision | null { return this.bindings.trajectory; }
  get files(): Readonly<Record<string, string>> { return this.bindings.files; }
  get trajectory(): TrajectoryRevision | null { return this.adopted; }
  get boundTrajectory(): BoundTrajectory | null { return this.bound?.buildId === this.trajectory?.buildId ? this.bound : null; }
  subscribe(listener: () => void): () => void { return this.changes.subscribe(listener); }

  async initialize(): Promise<void> {
    const pin = this.trajectory;
    if (pin === null) { this.bound = null; return; }
    if (this.bound?.buildId === pin.buildId) return;
    const { record, version } = await resolveTrajectoryBuild(pin);
    if (this.trajectory?.buildId !== pin.buildId || !this.editor.writable()) return;
    this.bound = { buildId: pin.buildId, file: record.artifacts.pht, name: version.snapshot.name,
      resourceId: version.resourceId, versionId: version.id, versionNumber: version.number, digest: record.artifacts.pht.digest };
    this.touch();
  }

  attachView(): () => void {
    if (this.view !== null) throw new Error("This document already has an editing view");
    const view = new ScenarioEvaluation({ rev: this.editor.rev, snapshot: this.workingSnapshot }, () => {
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
    if (version.kind !== "scenario" || resource !== undefined && resource.version.kind !== "scenario") throw new Error("Choose a saved scenario version");
    if (this.lifetime !== "active") throw new Error("The scenario is no longer editable");
    this.saved.restore(version, resource as SavedResource<"scenario"> | undefined, (effect) => {
      const trajectory = version.snapshot.bindings.trajectory;
      const transaction = this.editor.prepareTransaction({
        changes: { from: 0, to: this.editor.text().length, insert: version.snapshot.source.text },
        effects: [setScenarioBindings.of(this.bindingSnapshot(version.snapshot.bindings.files, trajectory)), effect],
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
    if (head?.kind !== "scenario" || head.revision !== this.saved.observedHead?.revision || version?.kind !== "scenario" || version.id !== head.headVersionId
      || !this.canAdoptExternal) return;
    if (this.saved.version.id !== version.id) this.reloadSaved({ head, version });
  }

  reloadSaved(resource: SavedResource): void {
    if (resource.version.kind !== "scenario" || resource.head.kind !== "scenario") throw new Error("Choose a saved scenario version");
    if (this.lifetime !== "active") throw new Error("The scenario is no longer editable");
    const snapshot = resource.version.snapshot;
    this.saved.adopt(resource as SavedResource<"scenario">, () => {
      this.editing.reset();
      const trajectory = snapshot.bindings.trajectory;
      const bindings = this.bindingSnapshot(snapshot.bindings.files, trajectory);
      this.editor.reset(snapshot.source.text, [scenarioBindings.init(() => bindings), scenarioBindingHistory, savedHistory]);
      this.edited();
    });
  }

  commitFieldInputs(): PendingIssue | null {
    if (this.lifetime !== "active") throw new Error("Scenario is not editable");
    return commitFieldInputs(this.editor);
  }

  prepareSnapshot(): PendingIssue | null {
    if (this.editing.busy) return { kind: "busy", message: "Finish or cancel the current edit first." };
    const fields = prepareFieldInputs(this.editor);
    if (!fields.ok) return fields.issue;
    const tables = this.editing.prepareTables(fields.value);
    if (!tables.ok) return tables.issue;
    return commitFieldInputs(this.editor, {}, () => this.editing.clearTableInputs(), tables.value);
  }

  async adopt(trajectory: TrajectoryRevision): Promise<Prepared<void>> {
    const previous = this.editor.raw(["trajectory"]);
    const previousBinding = this.trajectory;
    const { record, version, pin } = await resolveTrajectoryBuild(trajectory);
    if (!this.editor.writable() || this.editor.raw(["trajectory"]) !== previous || this.trajectory !== previousBinding) throw new Error("Trajectory changed. Choose the trajectory again.");
    const file = record.artifacts.pht;
    const name = this.selectedName(file.name);
    if (this.names().some((reference) => reference.key !== "trajectory" && reference.name === name)
      && this.files[name] !== undefined && this.files[name] !== file.digest) throw this.fileCollision(name);
    const changes = [{ path: ["trajectory"], value: name }];
    const spec = this.fileTransaction(changes, this.files, pin);
    const transaction = spec === null ? null : this.editor.prepareTransaction(spec);
    this.bound = { buildId: pin.buildId, file, name: version.snapshot.name, resourceId: version.resourceId, versionId: version.id, versionNumber: version.number, digest: file.digest };
    publishFieldChanges(this.editor, transaction, changes);
    if (transaction === null) this.touch();
    return { ok: true, value: undefined };
  }

  addNamedFiles(key: ScenarioFileField, selections: readonly ScenarioFileSelection[]): void {
    if (!this.editor.writable() || selections.length === 0) return;
    if (key === "antenna" && selections.length !== 1) throw new Error("Choose one antenna file");
    const path = key.split(".");
    const current = this.editor.value(path);
    if ((key === "ephemeris" || key === "almanac") && current !== undefined && !Array.isArray(current) && !isRecord(current)) {
      throw new Error(`Fix the ${key} field before adding files`);
    }
    if (key.startsWith("precise.")
      && (!isRecord(this.editor.value(["precise"])) || (current !== undefined && !Array.isArray(current) && typeof current !== "string"))) {
      throw new Error(`Fix the ${key} field before adding files`);
    }
    if (key === "antenna" && current !== undefined && typeof current !== "string") throw new Error("Fix the antenna field before selecting a file");

    const files = Object.assign(Object.create(null) as Record<string, string>, this.files);
    const added: string[] = [];
    for (const selection of selections) {
      const name = this.selectedName(selection.name);
      this.checkFileSelection(name, selection.digest);
      if (added.includes(name) && files[name] !== selection.digest) throw this.fileCollision(name);
      files[name] = selection.digest;
      if (!added.includes(name)) added.push(name);
    }
    const previous = new Set(this.fileNames(key));
    const fresh = added.filter((name) => !previous.has(name));
    const named = key === "ephemeris" || key === "almanac";
    const changes: WriteChange[] = [];
    if (key === "antenna") changes.push({ path, value: added[0] });
    else if (named && current === undefined && fresh.length === 1) changes.push({ path, value: { name: fresh[0] } });
    else {
      let value = current;
      let raw = this.editor.raw(path);
      for (const name of fresh) {
        const item = named ? { name } : name;
        changes.push(...appendCollectionItem(path, value, raw, item));
        value = [...listOf(value), item];
        raw = JSON.stringify(value);
      }
    }
    this.applyFiles(changes, files);
  }

  selectNamedFile(reference: ScenarioFileReference, selection: ScenarioFileSelection): void {
    if (!this.editor.writable()) return;
    this.checkReference(reference);
    const name = this.selectedName(selection.name);
    this.checkFileSelection(name, selection.digest, reference);
    this.applyFiles([{ path: reference.path, value: name }], { ...this.files, [name]: selection.digest });
  }

  removeNamedFile(reference: ScenarioFileReference): void {
    if (!this.editor.writable()) return;
    this.checkReference(reference);
    const field = reference.key.split(".");
    const current = this.editor.value(field);
    const path = Array.isArray(current) && current.length > 1
      ? reference.path.slice(0, reference.key === "ephemeris" || reference.key === "almanac" ? -1 : undefined)
      : field;
    this.applyFiles([{ path, value: undefined }], this.files);
  }

  private selectedName(name: string): string {
    const selected = inputFileName(name);
    if (selected.trim() === "" || selected === "." || selected === "..") throw new Error("Choose a file with a name.");
    return selected;
  }

  private fileCollision(name: string): Error {
    return new Error(`Another input named ${name} has different contents. Choose a different filename.`);
  }

  private checkReference(reference: ScenarioFileReference): void {
    if (reference.key === "trajectory") throw new Error("Choose a trajectory from Library.");
    if (!this.references(reference.key).some((current) => current.name === reference.name && this.sameReference(current, reference))) throw new Error("File reference changed. Review it and choose again.");
  }

  private sameReference(left: ScenarioFileReference, right: ScenarioFileReference): boolean {
    return left.key === right.key && left.path.length === right.path.length && left.path.every((part, index) => part === right.path[index]);
  }

  private checkFileSelection(name: string, digest: string, replacing?: ScenarioFileReference): void {
    const references = this.names().filter((reference) => reference.name === name);
    if (this.files[name] !== undefined && this.files[name] !== digest
      && references.some((reference) => reference.key !== "trajectory" && (replacing === undefined || !this.sameReference(reference, replacing)))) {
      throw this.fileCollision(name);
    }
    if (this.adopted !== null && references.some((reference) => reference.key === "trajectory")
      && this.names().some((reference) => reference.key === "trajectory" && reference.name === name)
      && (this.bound?.buildId !== this.adopted.buildId || this.bound.file.digest !== digest)) {
      throw this.fileCollision(name);
    }
  }

  private fileTransaction(changes: readonly WriteChange[], available: Readonly<Record<string, string>>, trajectory = this.adopted): TransactionSpec | null {
    const transaction = writeTransaction(this.editor.text(), changes);
    const text = transaction === null ? this.editor.text() : this.editor.state().update({ ...transaction, filter: false }).state.doc.toString();
    const files: Record<string, string> = Object.create(null);
    for (const reference of scenarioFileReferences(jsonc.parse(text))) {
      const digest = Object.hasOwn(available, reference.name) ? available[reference.name] : undefined;
      if (reference.key !== "trajectory" && digest !== undefined) files[reference.name] = digest;
    }
    const changed = trajectory !== this.adopted
      || Object.keys(files).length !== Object.keys(this.files).length
      || Object.keys(files).some((name) => files[name] !== this.files[name]);
    if (transaction === null && !changed) return null;
    return {
      ...transaction,
      ...(changed ? { effects: setScenarioBindings.of(this.bindingSnapshot(files, trajectory)) } : {}),
      userEvent: "input.form", annotations: isolateHistory.of("full"),
    };
  }

  private applyFiles(changes: readonly WriteChange[], files: Readonly<Record<string, string>>): void {
    const spec = this.fileTransaction(changes, files);
    publishFieldChanges(this.editor, spec === null ? null : this.editor.prepareTransaction(spec), changes);
  }

  private bindingSnapshot(files: Readonly<Record<string, string>>, trajectory = this.adopted): ScenarioBindings {
    return Object.freeze({ files: Object.freeze(Object.assign(Object.create(null) as Record<string, string>, files)), trajectory });
  }

  private edited(): void {
    this.sequence++;
    this.saved.edited();
    if (this.view === null) this.editor.clearEvaluation();
    this.view?.update({ rev: this.editor.rev, snapshot: this.workingSnapshot });
    void this.initialize().catch(() => {});
    this.touch();
  }

  async save(): Promise<Prepared<ScenarioSavedVersion>> {
    const issue = this.prepareSnapshot();
    return issue === null ? { ok: true, value: await this.saved.save() } : { ok: false, issue };
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
    if (!this.editor.writable()) throw new Error("The scenario is no longer editable");
    this.editing.leaveView();
    this.lifetime = "deleting";
    this.view?.suspend();
    try { await this.saved.settled(); await commit(); this.dispose(); }
    catch (error) { this.lifetime = "active"; this.view?.resume(); this.touch(); throw error; }
  }

  private touch(): void { this.changeSequence++; this.changes.set({}); }

  draftLeap(): Leap {
    for (const name of this.fileNames("ephemeris")) {
      const d = this.view?.described.get(name);
      const first = d !== undefined && "coverage" in d ? d.coverage[0] : undefined;
      if (first !== undefined) return { seconds: first.leapSeconds, change: null, after: first.leapSeconds };
    }
    return presentLeap;
  }

  window(): ScenarioWindow | null {
    const latest = this.view?.currentResult ?? null;
    let startGpsMs: number;
    let durationMs: number;
    let leap: Leap;
    if (latest !== null) {
      startGpsMs = latest.window.startGpsMs;
      durationMs = latest.window.durationMs;
      leap = packedLeap(latest.window);
    } else {
      leap = this.draftLeap();
      const time = recordOf(this.editor.value(["time"]));
      const start = time === undefined ? null : gpsOfTime(time, leap);
      const duration = this.editor.value(["duration"]);
      const length = typeof duration === "number" ? duration : (this.view?.shape?.duration ?? null);
      if (start === null || length === null) return null;
      startGpsMs = start;
      durationMs = Math.round(length * 1000);
    }
    if (!Number.isFinite(startGpsMs) || !Number.isSafeInteger(durationMs) || durationMs <= 0
      || !gpsInCalendarRange(startGpsMs, leap) || !gpsInCalendarRange(startGpsMs + durationMs, leap)) return null;
    return { startGpsMs, durationMs, leap };
  }

  names(): ScenarioFileReference[] {
    return scenarioFileReferences(this.editor.value([]));
  }

  references(key: ScenarioFileField): ScenarioFileReference[] {
    return this.names().filter((reference) => reference.key === key);
  }

  fileNames(key: ScenarioFileField): string[] {
    return this.references(key).map((file) => file.name);
  }

  coverage(window: Pick<Window, "startGpsMs" | "durationMs">) {
    const names = this.fileNames("ephemeris");
    if (names.length === 0) return null;
    const coverage: Coverage[] = [];
    for (const name of names) {
      const described = this.view?.described.get(name);
      if (described === undefined || !("coverage" in described)) return null;
      coverage.push(...described.coverage);
    }
    const signals = listOf(this.editor.value(["signals"])).filter((signal) => typeof signal === "string");
    const bySignal = systemsOf(schemas.get().scenario?.properties?.signals ?? null);
    const needed = signals.flatMap((signal) => bySignal[signal] ?? []);
    return coverageWindow(coverage, needed, window);
  }

}
