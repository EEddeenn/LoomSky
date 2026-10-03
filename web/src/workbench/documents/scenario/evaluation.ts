import * as jsonc from "jsonc-parser";
import type { PackedSummary, Window } from "@/model/bundle";
import { compute } from "@/io/compute";
import { reserveInput } from "@/io/input";
import type { Coverage } from "@/io/pharos";
import { fileByteLength, fileBytes, getResourceHead, onStorageChanges } from "@/io/storage";
import type { DocumentDiagnostic } from "@/model/document";
import { scenarioFileReferences } from "@/model/scenario";
import type { GeneratedTrack } from "@/model/trajectory";
import type { ScenarioSnapshot } from "@/model/version";
import { compileScenarioSnapshot } from "./compile";
import type { SavedTrajectoryBuild } from "../trajectory/builds";

export type ScenarioResult = Readonly<{
  rev: number;
  digest: string;
  summary: PackedSummary;
  window: Window;
  bundle: Uint8Array<ArrayBuffer>;
  scenario: string;
  track: GeneratedTrack;
}>;

type Check = { diagnostics: readonly DocumentDiagnostic[] } & (
  | { status: "checking" | "errors" }
  | { status: "ready"; result: ScenarioResult }
);
type Source = { rev: number; snapshot: ScenarioSnapshot };
export type ScenarioRecovery = { successful: (Source & { engineIdentity: string }) | null };
type Packing = { source: Source; controller: AbortController; promise: Promise<void> };
type Described = { coverage: Coverage[] } | { error: string };
type Description = { digest: string; controller: AbortController };

export class ScenarioEvaluation {
  private source: Source;
  private check: Check = { status: "checking", diagnostics: [] };
  private successful: ScenarioResult | null = null;
  private successfulSource: ScenarioRecovery["successful"] = null;
  private recovering: { controller: AbortController } | null = null;
  private track: GeneratedTrack | null = null;
  private dependency: SavedTrajectoryBuild | null = null;
  private readonly unsubscribeStorage: () => void;
  private readonly coverage = new Map<string, Described>();
  private readonly descriptions = new Map<string, Description>();
  private packing: Packing | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = false;

  constructor(source: Source, private readonly notify: () => void) {
    this.source = source;
    this.unsubscribeStorage = onStorageChanges((change) => {
      if (change === null || change.scope === "resources" && change.key === this.dependency?.version.resourceId) void this.checkDependency();
    });
  }

  get status(): Check["status"] { return this.check.status; }
  get diagnostics(): readonly DocumentDiagnostic[] { return this.check.diagnostics; }
  get currentResult(): ScenarioResult | null { return this.check.status === "ready" ? this.check.result : null; }
  get lastSuccessful(): ScenarioResult | null { return this.successful; }
  get shape(): GeneratedTrack | null { return this.track; }
  get described(): ReadonlyMap<string, Described> { return this.coverage; }
  checkpoint(): ScenarioRecovery { return { successful: this.successfulSource }; }
  restoreRecovery(recovery: ScenarioRecovery): void { this.successfulSource = recovery.successful; }

  update(source: Source): void {
    const previous = this.source.snapshot.bindings;
    const next = source.snapshot.bindings;
    this.source = source;
    this.check = { status: "checking", diagnostics: this.check.diagnostics };
    this.cancelPacking();
    if (previous.trajectory?.versionId !== next.trajectory?.versionId || previous.trajectory?.buildId !== next.trajectory?.buildId) {
      this.track = null;
      this.dependency = null;
    }
    const names = new Set(this.ephemeris());
    for (const name of new Set([...this.descriptions.keys(), ...this.coverage.keys()])) {
      if (names.has(name) && previous.files[name] === next.files[name]) continue;
      this.cancelDescription(name);
      this.coverage.delete(name);
    }
    if (this.active) this.timer = setTimeout(() => { this.timer = undefined; void this.refresh(); }, 300);
  }

  resume(): void {
    this.active = true;
    void this.restoreSuccessful();
    if (this.check.status === "checking") void this.refresh();
    else this.describeInputs();
  }

  suspend(): void {
    this.active = false;
    this.cancelPacking();
    for (const name of this.descriptions.keys()) this.cancelDescription(name);
    this.recovering?.controller.abort();
    this.recovering = null;
    this.successful = null;
    this.track = null;
    this.dependency = null;
    this.coverage.clear();
    this.check = { status: "checking", diagnostics: [] };
  }

  dispose(): void { this.suspend(); this.unsubscribeStorage(); this.successfulSource = null; }

  private async checkDependency(): Promise<void> {
    const dependency = this.dependency;
    if (dependency === null || !this.active) return;
    let present = false;
    try { present = await getResourceHead(dependency.version.resourceId) !== undefined; } catch { return; }
    if (this.dependency !== dependency || present || !this.active) return;
    this.dependency = null;
    this.track = null;
    this.update(this.source);
    this.notify();
  }

  private async restoreSuccessful(): Promise<void> {
    const source = this.successfulSource;
    if (source === null || source.rev === this.source.rev || this.successful !== null || this.recovering !== null) return;
    const recovering = { controller: new AbortController() };
    this.recovering = recovering;
    try {
      const result = await compileScenarioSnapshot(source.snapshot, { priority: "interactive", signal: recovering.controller.signal }, this.dependency);
      if (!this.active || this.recovering !== recovering || this.successfulSource !== source || result.status !== "success") return;
      if (result.engineIdentity !== source.engineIdentity) { this.successfulSource = null; return; }
      this.successful = {
        rev: source.rev, digest: result.digest, summary: result.summary, window: result.summary.window,
        bundle: result.bundle, scenario: source.snapshot.source.text, track: result.track,
      };
      if (this.track === null) this.track = result.track;
      this.notify();
    } catch (error) {
      if (recovering.controller.signal.aborted) return;
      if (this.active && this.recovering === recovering) this.notify();
    } finally {
      if (this.recovering === recovering) this.recovering = null;
    }
  }

  private refresh(): Promise<void> {
    if (!this.active) return Promise.resolve();
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.packing !== null) return this.packing.promise;
    const packing: Packing = { source: this.source, controller: new AbortController(), promise: Promise.resolve() };
    this.packing = packing;
    this.check = { status: "checking", diagnostics: this.check.diagnostics };
    this.describeInputs();
    packing.promise = this.evaluate(packing);
    this.notify();
    return packing.promise;
  }

  private cancelPacking(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const packing = this.packing;
    this.packing = null;
    packing?.controller.abort();
  }

  private async evaluate(packing: Packing): Promise<void> {
    const { source: { rev, snapshot }, controller } = packing;
    try {
      const result = await compileScenarioSnapshot(snapshot, { priority: "interactive", signal: controller.signal }, this.dependency);
      if (this.packing !== packing || !this.active) return;
      if (this.dependency !== result.dependency) {
        this.dependency = result.dependency;
        await this.checkDependency();
        if (this.packing !== packing || !this.active) return;
      }
      if (result.track !== null) this.track = result.track;
      const diagnostics = result.diagnostics.toSorted((left, right) => Number(right.error) - Number(left.error));
      if (result.status === "success") {
        const successful: ScenarioResult = {
          rev, digest: result.digest, summary: result.summary, window: result.summary.window,
          bundle: result.bundle, scenario: snapshot.source.text, track: result.track,
        };
        this.successful = successful;
        this.successfulSource = { ...packing.source, engineIdentity: result.engineIdentity };
        this.check = { status: "ready", result: successful, diagnostics };
      } else this.check = { status: "errors", diagnostics };
    } catch (error) {
      if (this.packing !== packing || !this.active || controller.signal.aborted) return;
      this.check = {
        status: "errors",
        diagnostics: [{ file: "scenario", path: "", message: error instanceof Error ? error.message : String(error), code: "", error: true }],
      };
    } finally {
      if (this.packing === packing) this.packing = null;
    }
    this.notify();
  }

  private ephemeris(): string[] {
    return scenarioFileReferences(jsonc.parse(this.source.snapshot.source.text))
      .filter((reference) => reference.key === "ephemeris").map((reference) => reference.name);
  }

  private describeInputs(): void {
    for (const name of this.ephemeris()) void this.describe(name);
  }

  private cancelDescription(name: string): void {
    const description = this.descriptions.get(name);
    this.descriptions.delete(name);
    description?.controller.abort();
  }

  private async describe(name: string): Promise<void> {
    const digest = this.source.snapshot.bindings.files[name];
    const known = this.coverage.get(name);
    if (!this.active || digest === undefined || known !== undefined && "coverage" in known) return;
    if (this.descriptions.get(name)?.digest === digest) return;
    this.cancelDescription(name);
    const description: Description = { digest, controller: new AbortController() };
    this.descriptions.set(name, description);
    const signal = description.controller.signal;
    let release: (() => void) | undefined;
    try {
      const length = await fileByteLength(digest);
      signal.throwIfAborted();
      if (length === null) return;
      release = reserveInput(length, signal);
      const bytes = await fileBytes(digest);
      signal.throwIfAborted();
      if (bytes === null) return;
      const coverage = await compute.pack.describe({ name, digest, bytes }, { priority: "interactive", signal });
      if (this.descriptions.get(name) !== description || !this.active) return;
      this.coverage.set(name, { coverage });
      this.notify();
    } catch (error) {
      if (signal.aborted || this.descriptions.get(name) !== description || !this.active) return;
      this.coverage.set(name, { error: error instanceof Error ? error.message : String(error) });
      this.notify();
    } finally {
      release?.();
      if (this.descriptions.get(name) === description) this.descriptions.delete(name);
    }
  }
}
