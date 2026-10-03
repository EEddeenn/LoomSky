"use client";

import { useEffect, useId, type ReactNode } from "react";
import { diagnosticsAt, isJsonNumberLiteral, pathKey, type WriteChange } from "@/model/document";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import { listOf, useStore } from "@/core";
import type { Path } from "@/model/schema";
import { feedback, openProblems, reportProblem, resolveProblem } from "@/workbench/feedback";
import { useProblem } from "@/page/shared/feedback";
import { Button, FeedbackIcon } from "@/page/shared/ui";
import { Field, inputClass, Messages, NumberInput } from "@/page/shared/documents/editor";
import { editPublication, useIndexedSelection } from "@/workbench/documents/scenario/editing";
import { runDocumentEdit } from "@/workbench/documents/editing";

function integerInRange(raw: string, min?: number, max?: number): boolean {
  const value = Number(raw);
  return isJsonNumberLiteral(raw) && Number.isSafeInteger(value)
    && (min === undefined || value >= min) && (max === undefined || value <= max);
}

export function useTable(doc: ScenarioDoc, path: Path, allowSingleton = false) {
  const rowsOf = (value: unknown) => Array.isArray(value) ? value : allowSingleton ? listOf(value) : [];
  const rows = rowsOf(doc.editor.value(path));
  const conflictCue = useId();
  const key = pathKey(doc.kind, path);
  const saved = useStore(doc.editing.tables, (state) => state.entries[key]);
  const [selected, setSelected] = useIndexedSelection(doc, path, rows.length);
  const indices = (current: unknown[]) => [...selected].filter((index) => index >= 0 && index < current.length).sort((a, b) => a - b);
  const apply = (changes: (current: unknown[]) => WriteChange[] | null, input?: "batch" | "paste") => {
    const operation = () => {
      let applied = false;
      const success = runDocumentEdit({ kind: "scenario", id: doc.id }, () => editPublication(doc, () => {
        if (input !== undefined && doc.editing.tableConflict(path) !== null) return [];
        const edits = changes(rowsOf(doc.editor.value(path)));
        if (edits === null || edits.length === 0) return [];
        applied = true;
        return edits;
      }));
      return success && applied;
    };
    return input === undefined ? operation() : doc.editing.applyTableInput(path, input, operation);
  };
  return {
    rows, selected, setSelected, indices, apply, conflictCue,
    batch: saved?.batch ?? "", paste: saved?.paste ?? "", conflict: saved?.conflict ?? null,
    column: saved?.qualityColumn ?? "",
    toggle(index: number, checked: boolean) {
      setSelected((before) => new Set(checked ? [...before, index] : [...before].filter((item) => item !== index)));
    },
  };
}

export function TableControls({ doc, path, table, label, min, max, column, children }: {
  doc: ScenarioDoc;
  path: Path;
  table: ReturnType<typeof useTable>;
  label: string;
  min?: number;
  max?: number;
  column?: string;
  children?: ReactNode;
}) {
  const cue = useId();
  const conflictCue = table.conflictCue;
  const text = table.batch.trim();
  const literal = column === undefined ? text : /^\d+$/.test(text) ? String(Number(text)) : "";
  const ready = column !== "" && integerInRange(literal, min, max);
  const invalid = column !== "" && table.batch.trim() !== "" && !ready;
  const problem = `editor:${doc.id}:${pathKey(doc.kind, path)}:batch`;
  useProblem(problem, invalid ? {
    id: problem, level: "warning", scope: `Scenario · ${doc.id}`, title: `${label} not applied`,
    message: `Use a whole number${min === undefined ? "" : ` from ${min}`}${max === undefined ? "" : min === undefined ? ` up to ${max}` : ` to ${max}`}.`, location: pathKey(doc.kind, path),
  } : null);
  return <div className="flex min-w-0 flex-col gap-2 rounded-key bg-face p-2">
    {table.conflict === null ? null : <div className="flex flex-wrap items-center gap-2 text-small text-warn-ink">
      <p id={conflictCue} role="alert" className="m-0">{table.conflict}</p>
      <Button size="xs" onClick={() => doc.editing.discardTableInputs(path)}>Discard input</Button>
    </div>}
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-auto text-small text-ink2">{table.selected.size} of {table.rows.length} selected</span>
      <Button size="xs" aria-label={`Select all ${label} rows`} disabled={table.selected.size === table.rows.length} onClick={() => table.setSelected(new Set(table.rows.map((_, index) => index)))}>Select all</Button>
      <Button size="xs" aria-label={`Clear ${label} selection`} disabled={table.selected.size === 0} onClick={() => table.setSelected(new Set())}>Clear selection</Button>
    </div>
    {children}
    <div className="flex min-w-0 items-center gap-2">
      <input aria-label={`${label} batch value`} aria-invalid={invalid || table.conflict !== null} aria-describedby={table.conflict !== null ? conflictCue : invalid ? cue : undefined} inputMode="numeric" className={`${inputClass(invalid || table.conflict !== null ? "warn" : null, true)} min-w-0 flex-1`} value={table.batch} onChange={(event) => doc.editing.setTable(path, { batch: event.target.value })} placeholder="Value" />
      <Button size="xs" disabled={!ready || table.selected.size === 0 || table.conflict !== null}
        onClick={() => table.apply((current) => table.indices(current).map((index) => ({ path: column === undefined ? [...path, index] : [...path, index, column], number: literal })), "batch")}
      >Apply to {table.selected.size}</Button>
    </div>
    {invalid ? <button id={cue} type="button" className="inline-flex self-start items-center gap-1 text-small text-warn-ink" onClick={() => openProblems(problem)}>
      <FeedbackIcon level="warning" size={14} /><span className="underline underline-offset-3">Not applied</span>
    </button> : null}
  </div>;
}

export function IndexedTable({ doc, path, label, count, firstIndex = 1, min, max, unit = "index" }: {
  doc: ScenarioDoc;
  path: Path;
  label: string;
  count?: number;
  firstIndex?: number;
  min?: number;
  max?: number;
  unit?: string;
}) {
  const table = useTable(doc, path);
  const { rows, selected, paste, conflict, conflictCue } = table;
  const pasteCue = useId();
  const tokens = paste.trim().split(/[\s,]+/).filter(Boolean);
  const pasteIndices = (current: unknown[]) => selected.size > 0 ? table.indices(current) : current.map((_, index) => index);
  const invalidValues = tokens.some((token) => !integerInRange(token, min, max));
  const invalidPaste = tokens.length !== pasteIndices(rows).length || invalidValues;
  const pasteProblem = `editor:${doc.id}:${pathKey(doc.kind, path)}:paste`;
  const pasteFailed = useStore(feedback, (state) => state.problems.some((problem) => problem.id === pasteProblem));
  useEffect(() => { if (!invalidPaste || paste === "") resolveProblem(pasteProblem); }, [pasteProblem, invalidPaste, paste]);
  return <Field label={label} path={pathKey(doc.kind, path)}>
    <TableControls doc={doc} path={path} table={table} label={label} min={min} max={max} />
    {count !== undefined && rows.length !== count ? <div>
      <Button size="xs" onClick={() => table.apply((current) => [{ path, value: Array.from({ length: count }, (_, index) => current[index] ?? null) }])}>Resize to {count} entries</Button>
    </div> : null}
    <div className="max-h-[420px] min-w-0 overflow-y-auto overscroll-contain">
      <table className="w-full table-fixed border-collapse text-small">
        <thead className="sticky top-0 bg-panel text-left">
          <tr>
            <th className="w-8 p-1"><span className="sr-only">Select</span></th>
            <th className="w-16 p-1">Number</th>
            <th className="p-1">Value ({unit})</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((_, index) => <tr key={index} className="border-t border-line" data-path={pathKey(doc.kind, [...path, index])}>
            <td className="p-1"><input type="checkbox" aria-label={`Select ${label} ${index + firstIndex}`} checked={selected.has(index)} onChange={(event) => table.toggle(index, event.target.checked)} /></td>
            <td className="fn p-1">{index + firstIndex}</td>
            <td className="p-1">
              <NumberInput doc={doc.editor} path={[...path, index]} label={`${label} ${index + firstIndex}`} unit="" />
              <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, [...path, index])} />
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <details>
      <summary className="cursor-pointer text-small text-ink2">Paste values</summary>
      <div className="mt-2 flex flex-col gap-2">
        <p className="m-0 text-small text-ink3">Paste {pasteIndices(rows).length} values in row order{selected.size > 0 ? " for selected entries" : ""}.</p>
        <textarea aria-label={`Paste ${label}`} aria-invalid={conflict !== null || pasteFailed && invalidPaste} aria-describedby={conflict !== null ? conflictCue : pasteFailed && invalidPaste ? pasteCue : undefined}
          className={`${inputClass(conflict !== null || pasteFailed && invalidPaste ? "warn" : null, true)} h-20 p-2`} value={paste}
          onChange={(event) => doc.editing.setTable(path, { paste: event.target.value })} placeholder="Tab, comma or newline separated values" />
        <Button size="xs" disabled={conflict !== null || tokens.length === 0 || invalidPaste} onClick={() => table.apply((current) => {
          const indices = pasteIndices(current);
          if (tokens.length !== indices.length || invalidValues) {
            reportProblem({ id: pasteProblem, level: "warning", scope: `Scenario · ${doc.id}`, title: `Pasted ${label} not applied`,
              message: `Paste ${indices.length} whole numbers${min === undefined ? "" : ` from ${min}`}${max === undefined ? "" : min === undefined ? ` up to ${max}` : ` to ${max}`}.`, location: pathKey(doc.kind, path) });
            openProblems(pasteProblem);
            return null;
          }
          return indices.map((index, i) => ({ path: [...path, index], number: tokens[i]! }));
        }, "paste")}>Apply</Button>
        {pasteFailed && invalidPaste ? <button id={pasteCue} type="button" className="inline-flex self-start items-center gap-1 text-small text-warn-ink" onClick={() => openProblems(pasteProblem)}>
          <FeedbackIcon level="warning" size={14} /><span className="underline underline-offset-3">Not applied</span>
        </button> : null}
      </div>
    </details>
    <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, path, "self")} />
  </Field>;
}
