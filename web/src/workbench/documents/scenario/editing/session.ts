import { createStore } from "@/core";
import { pathKey, type TextDocument } from "@/model/document";
import type { Path } from "@/model/schema";
import { EditingSession } from "../../editing";
import type { EditingCheckpoint } from "../../editing/session";

export type TableState = { selected: Set<number>; batch: string; paste: string; qualityColumn: "" | "rurai" | "udrei"; conflict: string | null };
type TableBaseline = { path: Path; value: string | undefined; lists: { path: Path; value: string }[] };
type TablePatch = Partial<Pick<TableState, "selected" | "batch" | "paste" | "qualityColumn">>;
export type ScenarioEditingCheckpoint = EditingCheckpoint & Readonly<{
  tables: Readonly<Record<string, Omit<TableState, "selected"> & { selected: readonly number[] }>>;
  baselines: readonly (readonly [string, Omit<TableBaseline, "value"> & { value: string | null }])[];
  collections: Readonly<Record<string, number>>;
}>;

export class ScenarioSession extends EditingSession {
  readonly tables = createStore<{ entries: Readonly<Record<string, TableState>> }>({ entries: {} });
  readonly collections = createStore<{ selected: Readonly<Record<string, number>> }>({ selected: {} });
  private readonly source: TextDocument;
  private readonly baselines = new Map<string, TableBaseline>();
  private readonly applyingTables = new Set<string>();

  constructor(doc: TextDocument) { super(doc); this.source = doc; }

  override checkpoint(): ScenarioEditingCheckpoint {
    if (this.applyingTables.size > 0) throw new Error("Finish applying table input before saving.");
    return structuredClone({
      ...super.checkpoint(),
      tables: Object.fromEntries(Object.entries(this.tables.get().entries).map(([key, table]) => [key, { ...table, selected: [...table.selected] }])),
      baselines: [...this.baselines].map(([key, baseline]) => [key, { ...baseline, value: baseline.value ?? null }] as const),
      collections: this.collections.get().selected,
    });
  }

  override restoreCheckpoint(checkpoint: ScenarioEditingCheckpoint): void {
    const saved = structuredClone(checkpoint);
    this.applyingTables.clear();
    this.baselines.clear();
    for (const [key, baseline] of saved.baselines) this.baselines.set(key, { ...baseline, value: baseline.value ?? undefined });
    this.tables.set({ entries: Object.fromEntries(Object.entries(saved.tables).map(([key, table]) => [key, { ...table, selected: new Set(table.selected) }])) });
    this.collections.set({ selected: saved.collections });
    super.restoreCheckpoint(saved);
  }

  override get unapplied(): boolean {
    return Object.values(this.tables.get().entries).some((table) => table.batch !== "" || table.paste !== "");
  }

  setTable(path: Path, patch: TablePatch): void {
    const key = pathKey("scenario", path);
    const before = this.tables.get().entries[key] ?? { selected: new Set<number>(), batch: "", paste: "", qualityColumn: "", conflict: null };
    const table = { ...before, ...patch };
    const contentChanged = table.batch !== before.batch || table.paste !== before.paste;
    if (!contentChanged && table.selected === before.selected && table.qualityColumn === before.qualityColumn) return;
    if (table.batch === "" && table.paste === "") {
      this.baselines.delete(key);
      table.conflict = null;
    } else if (!this.baselines.has(key)) {
      this.baselines.set(key, {
        path: [...path], value: this.source.raw(path),
        lists: path.flatMap((part, depth) => {
          if (typeof part !== "number") return [];
          const parent = path.slice(0, depth);
          const value = this.source.value(parent);
          return Array.isArray(value) && value.some((item) => item !== null && typeof item === "object" && !Array.isArray(item))
            ? [{ path: parent, value: JSON.stringify(value) }] : [];
        }),
      });
    }
    this.tables.set((state) => ({ entries: { ...state.entries, [key]: table } }));
    if (contentChanged) this.changed();
  }

  private conflict(baseline: TableBaseline): string | null {
    if (baseline.lists.some((list) => JSON.stringify(this.source.value(list.path)) !== list.value)) {
      return "The list changed. Discard pending input before entering a new value.";
    }
    return this.source.raw(baseline.path) !== baseline.value
      ? "The table changed. Discard pending input before entering a new value."
      : null;
  }

  tableConflict(path: Path): string | null {
    const key = pathKey("scenario", path);
    const table = this.tables.get().entries[key];
    if (table === undefined || table.conflict !== null) return table?.conflict ?? null;
    const baseline = this.baselines.get(key);
    const conflict = baseline === undefined ? null : this.conflict(baseline);
    if (conflict !== null) {
      this.tables.set((state) => ({ entries: { ...state.entries, [key]: { ...table, conflict } } }));
      this.changed();
    }
    return conflict;
  }

  applyTableInput(path: Path, input: "batch" | "paste", operation: () => boolean): boolean {
    const key = pathKey("scenario", path);
    const table = this.tables.get().entries[key];
    if (table === undefined || table[input] === "" || this.applyingTables.has(key) || this.tableConflict(path) !== null) return false;
    this.applyingTables.add(key);
    try {
      const applied = operation();
      if (applied) this.setTable(path, { [input]: "" });
      return applied;
    } finally {
      this.applyingTables.delete(key);
      this.reconcile();
    }
  }

  tableIssues(): readonly { path: Path; message: string; text: string }[] {
    const entries = this.tables.get().entries;
    return [...this.baselines].flatMap(([key, baseline]) => {
      const table = entries[key];
      return table?.conflict == null ? [] : [{
        path: [...baseline.path], message: table.conflict,
        text: [table.batch === "" ? "" : `Batch value: ${table.batch}`, table.paste === "" ? "" : `Pasted values: ${table.paste}`].filter((text) => text !== "").join("\n"),
      }];
    });
  }

  discardTableInputs(path: Path): void {
    this.setTable(path, { batch: "", paste: "" });
  }

  override reconcile(): void {
    const entries = { ...this.tables.get().entries };
    let changed = false;
    for (const [key, baseline] of this.baselines) {
      const table = entries[key];
      if (table === undefined || table.conflict !== null || this.applyingTables.has(key)) continue;
      const conflict = this.conflict(baseline);
      if (conflict === null) continue;
      entries[key] = { ...table, conflict };
      changed = true;
    }
    if (changed) {
      this.tables.set({ entries });
      this.changed();
    }
  }

  selectCollection(path: Path, index: number): void {
    const key = pathKey("scenario", path);
    const selected = Math.max(0, index);
    if ((this.collections.get().selected[key] ?? 0) === selected) return;
    this.collections.set((state) => ({ selected: { ...state.selected, [key]: selected } }));
  }

  revealCollection(path: Path): void {
    path.forEach((part, index) => {
      if (typeof part === "number") this.selectCollection(path.slice(0, index), part);
    });
  }

  override reset(): void {
    this.applyingTables.clear();
    this.baselines.clear();
    this.tables.set({ entries: {} });
    this.collections.set({ selected: {} });
    super.reset();
  }
}
