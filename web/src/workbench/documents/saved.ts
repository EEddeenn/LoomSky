import { invertedEffects } from "@codemirror/commands";
import { StateEffect, StateField, Transaction, type EditorState } from "@codemirror/state";
import type { SaveState } from "@/model/document";
import { immutableCopy, type ResourceHead, type SavedVersion } from "@/model/version";

type Restoration = Readonly<{ versionId: string }>;
type RestorationChange = Readonly<{ before: Restoration | null; after: Restoration | null }>;
const setRestoration = StateEffect.define<RestorationChange>();
const restoration = StateField.define<Restoration | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setRestoration)) value = effect.value.after;
    return value;
  },
});

export const savedHistory = [restoration, invertedEffects.of((transaction) => transaction.effects.toReversed().flatMap((effect) => effect.is(setRestoration)
  ? [setRestoration.of({ before: effect.value.after, after: effect.value.before })]
  : []))];

type WorkingCopy<V extends SavedVersion> = {
  snapshot(): V["snapshot"];
  state(): EditorState;
  publish(transaction: Transaction): void;
  notify(): void;
  append(snapshot: V["snapshot"], restoredFrom: string | null): Promise<Saved<V>>;
};

type Saved<V extends SavedVersion> = { head: Extract<ResourceHead, { kind: V["kind"] }>; version: V };

function sameSnapshot(left: SavedVersion["snapshot"], right: SavedVersion["snapshot"]): boolean {
  if (left.source.text !== right.source.text) return false;
  if ("name" in left) return "name" in right && left.name === right.name;
  if (!("bindings" in right)) return false;
  const before = left.bindings, after = right.bindings;
  return before.trajectory?.versionId === after.trajectory?.versionId
    && before.trajectory?.buildId === after.trajectory?.buildId
    && Object.keys(before.files).length === Object.keys(after.files).length
    && Object.entries(before.files).every(([name, digest]) => Object.hasOwn(after.files, name) && after.files[name] === digest);
}

export class SavedWorkingCopy<V extends SavedVersion> {
  private baseline: V;
  private baselineHead: Saved<V>["head"];
  private observed: ResourceHead | null;
  private requests = 0;
  private failure: string | null = null;
  private dirtyCache: boolean | null = null;
  private persistence: Promise<void> = Promise.resolve();
  private readonly working: WorkingCopy<V>;

  constructor(resource: Saved<V>, working: WorkingCopy<V>) {
    this.baseline = resource.version;
    this.baselineHead = resource.head;
    this.observed = resource.head;
    this.working = working;
  }

  get version(): V { return this.baseline; }
  get head(): ResourceHead { return this.baselineHead; }
  get observedHead(): ResourceHead | null { return this.observed; }
  get saving(): boolean { return this.requests > 0; }
  get dirty(): boolean { return this.dirtyCache ??= !sameSnapshot(this.baseline.snapshot, this.working.snapshot()); }
  get state(): SaveState {
    return this.requests > 0 ? { status: "saving" }
      : this.failure !== null ? { status: "error", message: this.failure }
      : { status: this.dirty ? "pending" : "saved" };
  }

  get issue(): string | null { return this.failure; }

  edited(): void { this.dirtyCache = null; }
  settled(): Promise<void> { return this.persistence; }

  observe(head: ResourceHead | null): void {
    if (head !== null && (head.id !== this.baseline.resourceId || head.kind !== this.baseline.kind)) throw new Error("The saved version belongs to another resource");
    if (head !== null && this.observed !== null && head.revision < this.observed.revision) return;
    if (head?.revision === this.observed?.revision && head?.headVersionId === this.observed?.headVersionId) return;
    this.observed = head;
    this.working.notify();
  }

  adopt(resource: Saved<V>, apply: () => void): void {
    if (resource.head.id !== this.baseline.resourceId || resource.version.resourceId !== this.baseline.resourceId) throw new Error("Choose a saved version of this resource");
    if (this.saving) throw new Error("Wait for saving to finish before loading a version");
    const previous = { version: this.baseline, head: this.baselineHead, observed: this.observed };
    this.baseline = resource.version;
    this.dirtyCache = null;
    this.baselineHead = resource.head;
    if (this.observed === null || this.observed.revision <= resource.head.revision) this.observed = resource.head;
    try {
      apply();
    } catch (error) {
      this.baseline = previous.version;
      this.dirtyCache = null;
      this.baselineHead = previous.head;
      this.observed = previous.observed;
      throw error;
    }
    this.failure = null;
    this.working.notify();
  }

  restore(version: V, head: Saved<V> | undefined, apply: (effect: StateEffect<RestorationChange>) => void): void {
    if (version.resourceId !== this.baseline.resourceId) throw new Error("Choose a saved version of this resource");
    this.adopt(head ?? { head: this.baselineHead, version: this.baseline }, () => {
      apply(setRestoration.of({ before: this.working.state().field(restoration), after: { versionId: version.id } }));
    });
  }

  async save(): Promise<V> {
    const snapshot = immutableCopy(this.working.snapshot());
    const restored = this.working.state().field(restoration);
    this.requests++;
    this.working.notify();
    const task = this.persistence.then(async () => {
      const resource = await this.working.append(snapshot, restored?.versionId ?? null);
      const version = resource.version;
      this.baseline = version;
      this.dirtyCache = null;
      this.baselineHead = resource.head;
      if (this.observed === null || this.observed.revision <= resource.head.revision) this.observed = resource.head;
      if (restored !== null && this.working.state().field(restoration) === restored) {
        const transaction = this.working.state().update({ effects: setRestoration.of({ before: restored, after: null }), annotations: Transaction.addToHistory.of(false) });
        void transaction.state;
        this.working.publish(transaction);
      }
      return version;
    });
    this.persistence = task.then(() => undefined, () => undefined);
    try {
      const version = await task;
      this.failure = null;
      return version;
    } catch (error) {
      this.failure = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.requests--;
      this.working.notify();
    }
  }
}
