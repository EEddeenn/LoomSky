import { createStore, recordOf } from "@/core";
import { fieldReference, isJsonNumberLiteral, pathKey, type Prepared, type TextDocument, type WriteChange } from "@/model/document";
import { lookup, type Path } from "@/model/schema";
import { schemas } from "@/workbench/schemas";
import { EditingSession } from "../../editing";

export type TableState = { selected: Set<number>; batch: string; paste: string; qualityColumn: "" | "rurai" | "udrei"; conflict: string | null };
type TableBaseline = { path: Path; value: string | undefined; lists: { path: Path; value: string }[] };
type TablePatch = Partial<Pick<TableState, "selected" | "batch" | "paste" | "qualityColumn">>;

export function integerInRange(raw: string, min?: number, max?: number): boolean {
  const value = Number(raw);
  return isJsonNumberLiteral(raw) && Number.isSafeInteger(value)
    && (min === undefined || value >= min) && (max === undefined || value <= max);
}

export class ScenarioSession extends EditingSession {
  readonly tables = createStore<{ entries: Readonly<Record<string, TableState>> }>({ entries: {} });
  readonly collections = createStore<{ selected: Readonly<Record<string, number>> }>({ selected: {} });
  private readonly source: TextDocument;
  private readonly baselines = new Map<string, TableBaseline>();
  private readonly applyingTables = new Set<string>();

  constructor(doc: TextDocument) { super(doc); this.source = doc; }

  override get unapplied(): boolean {
    return Object.values(this.tables.get().entries).some((table) => table.batch !== "" || table.paste !== "");
  }

  setTable(path: Path, patch: TablePatch): void {
    const key = pathKey("scenario", path);
    const before = this.tables.get().entries[key] ?? { selected: new Set<number>(), batch: "", paste: "", qualityColumn: "", conflict: null };
    const table = { ...before, ...patch, conflict: null };
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
    if (table === undefined) return null;
    const baseline = this.baselines.get(key);
    const conflict = baseline === undefined ? null : this.conflict(baseline);
    if (conflict !== null) {
      this.tables.set((state) => ({ entries: { ...state.entries, [key]: { ...table, conflict } } }));
      this.changed();
    }
    return conflict;
  }

  private inputIssue(path: Path, message: string): Extract<Prepared<never>, { ok: false }> {
    const key = pathKey("scenario", path);
    const table = this.tables.get().entries[key];
    if (table !== undefined && table.conflict !== message) {
      this.tables.set((state) => ({ entries: { ...state.entries, [key]: { ...table, conflict: message } } }));
      this.changed();
    }
    return { ok: false, issue: { kind: "field", issue: { ref: fieldReference(this.source, path), path, message } } };
  }

  private prepareTableInput(path: Path, input: "batch" | "paste"): Prepared<readonly WriteChange[]> {
    const key = pathKey("scenario", path);
    const table = this.tables.get().entries[key];
    if (table === undefined || table[input] === "") return { ok: true, value: [] };
    const conflict = this.tableConflict(path);
    if (conflict !== null) return this.inputIssue(path, conflict);
    const raw = this.source.value(path);
    const rows = Array.isArray(raw) ? raw : recordOf(raw) === undefined ? [] : [raw];
    const selected = [...table.selected].filter((index) => index >= 0 && index < rows.length).sort((a, b) => a - b);
    const indices = input === "paste" && selected.length === 0 ? rows.map((_, index) => index) : selected;
    if (indices.length === 0) return this.inputIssue(path, "Select the rows to update.");
    const quality = rows.some((row) => recordOf(row) !== undefined);
    const column = quality ? table.qualityColumn : undefined;
    if (column === "") return this.inputIssue(path, "Choose a quality index to update.");
    const itemPath = [...path, ...(Array.isArray(raw) ? [indices[0]!] : []), ...(column === undefined ? [] : [column])];
    const meta = lookup(schemas.get().scenario, itemPath, (at) => this.source.value(at));
    const tokens = input === "paste" ? table.paste.trim().split(/[\s,]+/).filter(Boolean) : [table.batch.trim()];
    const values = column === undefined ? tokens : tokens.map((text) => /^\d+$/.test(text) ? String(Number(text)) : "");
    if (input === "paste" && values.length !== indices.length) return this.inputIssue(path, `Paste ${indices.length} values in row order.`);
    if (values.some((value) => !integerInRange(value, meta?.minimum, meta?.maximum))) return this.inputIssue(path,
      `Use a whole number${meta?.minimum === undefined ? "" : ` from ${meta.minimum}`}${meta?.maximum === undefined ? "" : meta.minimum === undefined ? ` up to ${meta.maximum}` : ` to ${meta.maximum}`}.`);
    return { ok: true, value: indices.map((index, position) => ({
      path: [...path, ...(Array.isArray(raw) ? [index] : []), ...(column === undefined ? [] : [column])],
      number: values[input === "batch" ? 0 : position]!,
    })) };
  }

  prepareTables(fieldChanges: readonly WriteChange[] = []): Prepared<readonly WriteChange[]> {
    const changes: WriteChange[] = [];
    const valueOf = (change: WriteChange) => change.number !== undefined ? Number(change.number)
      : change.json !== undefined ? JSON.parse(change.json) : change.value;
    for (const { path } of this.baselines.values()) {
      for (const input of ["batch", "paste"] as const) {
        const prepared = this.prepareTableInput(path, input);
        if (!prepared.ok) return prepared;
        for (const change of prepared.value) {
          if ([...fieldChanges, ...changes].some((other) => {
            const overlap = other.path.every((part, index) => part === change.path[index]) || change.path.every((part, index) => part === other.path[index]);
            return overlap && (other.path.length !== change.path.length || JSON.stringify(valueOf(other)) !== JSON.stringify(valueOf(change)));
          })) return this.inputIssue(path, "This table has different pending values for the same row. Clear one of those inputs before saving.");
        }
        changes.push(...prepared.value);
      }
    }
    return { ok: true, value: changes };
  }

  clearTableInputs(): void {
    for (const { path } of [...this.baselines.values()]) this.discardTableInputs(path);
  }

  applyTableInput(path: Path, input: "batch" | "paste"): Prepared<void> {
    if (!this.source.writable()) return this.inputIssue(path, "This scenario is no longer editable.");
    const prepared = this.prepareTableInput(path, input);
    if (!prepared.ok) return prepared;
    const key = pathKey("scenario", path);
    this.applyingTables.add(key);
    try {
      this.source.writeMany(prepared.value);
      this.setTable(path, { [input]: "" });
      return { ok: true, value: undefined };
    } catch (error) {
      return this.inputIssue(path, error instanceof Error ? error.message : String(error));
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
