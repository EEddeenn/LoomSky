import { compute, createDemand, type ComputeDemand } from "@/io/compute";
import type { DocumentDiagnostic } from "@/model/document";
import type { GeneratedTrack, Track } from "@/model/trajectory";

type Source = { revision(): number; text(): string; active(): boolean };
type Solve = { controller: AbortController; demand: ComputeDemand; result: Promise<{ engineIdentity: string; value: Track }> };
type GenerationTask = { solve: Solve; rev: number; text: string; promise: Promise<void> };
export type TrajectoryRecovery = { successful: { rev: number; text: string; engineIdentity: string } | null };
type PreviewRequest = { text: string; rev: number; sequence: number; resolve(track: Track | null): void };
type PreviewTask = { request: PreviewRequest; solve: Solve };
type Generation =
  | { status: "checking"; ghost: Track | null; diagnostics: readonly DocumentDiagnostic[] }
  | { status: "ready"; rev: number; track: GeneratedTrack; diagnostics: readonly DocumentDiagnostic[] }
  | { status: "errors"; rev: number; track: Track | null; ghost: Track | null; diagnostics: readonly DocumentDiagnostic[] };
type Preview =
  | { status: "idle" | "checking"; diagnostics: readonly DocumentDiagnostic[] }
  | { status: "ready"; text: string; rev: number; engineIdentity: string; track: GeneratedTrack; diagnostics: readonly DocumentDiagnostic[] }
  | { status: "errors"; text: string; rev: number; track: Track | null; diagnostics: readonly DocumentDiagnostic[] };

function diagnosticsOf(track: Track): DocumentDiagnostic[] {
  const diagnostics: DocumentDiagnostic[] = track.diagnostics.map((diagnostic) => ({ ...diagnostic, file: "trajectory" }));
  if (track.pht === null && !diagnostics.some((diagnostic) => diagnostic.error)) diagnostics.push({
    file: "trajectory", path: "", message: track.error || "Could not solve trajectory", code: "", error: true,
  });
  return diagnostics;
}

function errorDiagnostics(error: unknown): DocumentDiagnostic[] {
  return [{ file: "trajectory", path: "", message: error instanceof Error ? error.message : String(error), code: "", error: true }];
}

function shapeOf(generation: Generation): Track | null {
  const track = generation.status === "checking" ? null : generation.track;
  return track !== null && track.states.length > 0 ? track : generation.status === "ready" ? generation.track : generation.ghost;
}

export class TrajectoryEvaluation {
  private generation: Generation = { status: "checking", ghost: null, diagnostics: [] };
  private previewState: Preview = { status: "idle", diagnostics: [] };
  private generationTask: GenerationTask | null = null;
  private previewActive: PreviewTask | null = null;
  private previewPending: PreviewRequest | null = null;
  private previewSequence = 0;
  private generationTimer: ReturnType<typeof setTimeout> | null = null;
  private evaluating = false;
  private successfulSource: TrajectoryRecovery["successful"] = null;
  private recovering: { solve: Solve } | null = null;

  constructor(private readonly source: Source, private readonly notify: () => void) {}

  get ready(): boolean { return this.verified !== null; }
  get verified(): GeneratedTrack | null {
    const generation = this.generation;
    return this.source.active() && generation.status === "ready" && generation.rev === this.source.revision() ? generation.track : null;
  }
  get status(): "checking" | "ready" | "errors" { return this.generation.status; }
  get diagnostics(): readonly DocumentDiagnostic[] { return this.generation.diagnostics; }
  get currentTrack(): Track | null {
    const generation = this.generation;
    return generation.status !== "checking" && generation.rev === this.source.revision() ? generation.track : null;
  }
  get currentShape(): Track | null {
    const track = this.currentTrack;
    return track !== null && track.states.length > 0 ? track : null;
  }
  get shape(): Track | null {
    return this.currentShape ?? (this.generation.status === "ready" ? this.generation.track : this.generation.ghost);
  }
  get previewDiagnostics(): readonly DocumentDiagnostic[] { return this.previewState.diagnostics; }
  get previewTrack(): Track | null {
    return this.previewState.status === "ready" || this.previewState.status === "errors" ? this.previewState.track : null;
  }
  get previewShape(): Track | null {
    const track = this.previewTrack;
    return track !== null && track.states.length > 0 ? track : null;
  }
  private get active(): boolean { return this.evaluating && this.source.active(); }
  checkpoint(): TrajectoryRecovery { return { successful: this.successfulSource }; }
  restoreRecovery(recovery: TrajectoryRecovery): void { this.successfulSource = recovery.successful; }

  suspend(): void {
    this.evaluating = false;
    this.stop();
    this.generation = { status: "checking", ghost: null, diagnostics: [] };
  }

  resume(): void {
    this.evaluating = true;
    void this.restoreSuccessful();
    if (this.generation.status === "checking") void this.refresh();
  }

  stop(): void {
    this.clearGenerationTimer();
    this.stopGeneration();
    this.clearPreview();
    this.recovering?.solve.controller.abort();
    this.recovering = null;
    this.notify();
  }

  dispose(): void { this.suspend(); this.successfulSource = null; }

  private async restoreSuccessful(): Promise<void> {
    const source = this.successfulSource;
    if (source === null || source.rev === this.source.revision() || this.shape !== null || this.recovering !== null) return;
    const recovering = { solve: this.solve(source.text, "interactive") };
    this.recovering = recovering;
    try {
      const { engineIdentity, value: track } = await recovering.solve.result;
      if (!this.active || this.recovering !== recovering || this.successfulSource !== source || track.pht === null
        || diagnosticsOf(track).some((item) => item.error) || this.generation.status === "ready") return;
      if (engineIdentity !== source.engineIdentity) { this.successfulSource = null; return; }
      this.generation = { ...this.generation, ghost: track };
      this.notify();
    } catch (error) {
      if (recovering.solve.controller.signal.aborted) return;
      if (this.active && this.recovering === recovering) this.notify();
    } finally {
      if (this.recovering === recovering) this.recovering = null;
    }
  }

  edited(): void {
    const ghost = shapeOf(this.generation);
    this.stopGeneration();
    this.clearPreview();
    this.clearGenerationTimer();
    this.generation = { status: "checking", ghost, diagnostics: this.diagnostics };
    if (this.active) this.generationTimer = setTimeout(() => { this.generationTimer = null; void this.refresh(); }, 300);
    this.notify();
  }

  private solve(text: string, priority: "interactive" | "background"): Solve {
    const controller = new AbortController();
    const demand = createDemand(priority);
    return { controller, demand, result: compute.traj.solve(text, { priority: demand, signal: controller.signal }) };
  }

  private clearGenerationTimer(): void {
    if (this.generationTimer !== null) clearTimeout(this.generationTimer);
    this.generationTimer = null;
  }

  private stopGeneration(): void {
    const task = this.generationTask;
    this.generationTask = null;
    task?.solve.controller.abort();
  }

  private startGeneration(solve: Solve): GenerationTask {
    this.clearGenerationTimer();
    const task = { solve, rev: this.source.revision(), text: this.source.text(), promise: Promise.resolve() };
    this.generationTask = task;
    this.generation = { status: "checking", ghost: this.shape, diagnostics: this.diagnostics };
    task.promise = this.finishGeneration(task);
    this.notify();
    return task;
  }

  private async finishGeneration(task: GenerationTask): Promise<void> {
    try {
      const { engineIdentity, value: track } = await task.solve.result;
      if (!this.active || this.generationTask !== task || task.rev !== this.source.revision()) return;
      const diagnostics = diagnosticsOf(track);
      this.generation = track.pht !== null && !diagnostics.some((diagnostic) => diagnostic.error)
        ? { status: "ready", rev: task.rev, track, diagnostics }
        : { status: "errors", rev: task.rev, track, ghost: this.shape, diagnostics };
      if (this.generation.status === "ready") this.successfulSource = { rev: task.rev, text: task.text, engineIdentity };
    } catch (error) {
      if (!this.active || this.generationTask !== task || task.solve.controller.signal.aborted) return;
      this.generation = { status: "errors", rev: task.rev, track: null, ghost: this.shape, diagnostics: errorDiagnostics(error) };
    } finally {
      if (this.generationTask === task) this.generationTask = null;
    }
    this.notify();
  }

  async refresh(priority: "background" | "action" = "background"): Promise<void> {
    if (!this.active) return;
    this.clearGenerationTimer();
    const task = this.generationTask ?? this.startGeneration(this.solve(this.source.text(), "interactive"));
    const release = priority === "action" ? task.solve.demand.hold("action") : undefined;
    try { await task.promise; }
    finally { release?.(); }
  }

  preview(text: string, baselineRev: number): Promise<Track | null> {
    if (!this.active || baselineRev !== this.source.revision()) return Promise.resolve(null);
    this.previewSequence++;
    this.previewPending?.resolve(null);
    this.previewPending = null;
    this.previewState = { status: "checking", diagnostics: this.previewState.diagnostics };
    const promise = new Promise<Track | null>((resolve) => {
      const request = { text, rev: baselineRev, sequence: this.previewSequence, resolve };
      if (this.previewActive?.request.text === text && this.previewActive.request.rev === baselineRev && !this.previewActive.solve.controller.signal.aborted) {
        this.previewActive.request.resolve(null);
        this.previewActive.request = request;
      } else this.previewPending = request;
    });
    this.notify();
    this.drainPreview();
    return promise;
  }

  private drainPreview(): void {
    if (!this.active || this.previewActive !== null || this.previewPending === null) return;
    const request = this.previewPending;
    this.previewPending = null;
    const active = { request, solve: this.solve(request.text, "interactive") };
    this.previewActive = active;
    void this.finishPreview(active);
  }

  private async finishPreview(active: PreviewTask): Promise<void> {
    let result: Track | null = null;
    try {
      const { engineIdentity, value: track } = await active.solve.result;
      const latest = active.request;
      if (this.active && this.previewActive === active && latest.sequence === this.previewSequence && latest.rev === this.source.revision()) {
        const diagnostics = diagnosticsOf(track);
        this.previewState = track.pht !== null && !diagnostics.some((diagnostic) => diagnostic.error)
          ? { status: "ready", text: latest.text, rev: latest.rev, engineIdentity, track, diagnostics }
          : { status: "errors", text: latest.text, rev: latest.rev, track, diagnostics };
        result = track;
        this.notify();
      }
    } catch (error) {
      const latest = active.request;
      if (this.active && this.previewActive === active && latest.sequence === this.previewSequence && latest.rev === this.source.revision() && !active.solve.controller.signal.aborted) {
        this.previewState = { status: "errors", text: latest.text, rev: latest.rev, track: null, diagnostics: errorDiagnostics(error) };
        this.notify();
      }
    }
    active.request.resolve(result);
    if (this.previewActive === active) {
      this.previewActive = null;
      this.drainPreview();
    }
  }

  private clearPreview(): void {
    this.previewSequence++;
    this.previewPending?.resolve(null);
    this.previewPending = null;
    const active = this.previewActive;
    this.previewActive = null;
    active?.request.resolve(null);
    active?.solve.controller.abort();
    this.previewState = { status: "idle", diagnostics: [] };
  }

  cancelPreview(): void {
    this.clearPreview();
    this.notify();
  }

  commitPreview(text: string, baselineRev: number, apply: () => void): void {
    const preview = this.previewState;
    const result = (preview.status === "ready" || preview.status === "errors") && preview.text === text && preview.rev === baselineRev ? preview : null;
    const active = this.previewActive;
    const continued = this.active && result === null && active?.request.text === text && active.request.rev === baselineRev && !active.solve.controller.signal.aborted
      ? active.solve : null;
    if (continued !== null && active !== null) {
      this.previewActive = null;
      active.request.resolve(null);
    }
    const ghost = this.shape;
    this.clearPreview();
    try { apply(); }
    catch (error) {
      continued?.controller.abort();
      this.notify();
      throw error;
    }
    if (result !== null) {
      this.clearGenerationTimer();
      this.generation = result.status === "ready"
        ? { status: "ready", rev: this.source.revision(), track: result.track, diagnostics: result.diagnostics }
        : { status: "errors", rev: this.source.revision(), track: result.track, ghost, diagnostics: result.diagnostics };
      if (result.status === "ready") this.successfulSource = { rev: this.source.revision(), text, engineIdentity: result.engineIdentity };
      this.notify();
    } else if (continued !== null) {
      if (this.active) this.startGeneration(continued);
      else continued.controller.abort();
    }
  }
}
