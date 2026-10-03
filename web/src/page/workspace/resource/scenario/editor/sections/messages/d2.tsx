"use client";

import { diagnosticsAt, pathKey } from "@/model/document";
import { listOf, recordOf } from "@/core";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import type { Path } from "@/model/schema";
import { Button, Fig } from "@/page/shared/ui";
import { Field, Messages, NumberField, Select, useSchema, WordSelect } from "@/page/shared/documents/editor";
import { IndexedTable, OptionalBlock, SatelliteSetField } from "@/page/workspace/resource/scenario/editor/fields";
import { editPublication } from "@/workbench/documents/scenario/editing";
import { runDocumentEdit } from "@/workbench/documents/editing";
import type { PublicationRules } from "@/model/scenario";
import { TableControls, useTable } from "../../fields/indexed";

export function D2Publication({ doc, path, rules }: { doc: ScenarioDoc; path: Path; rules: PublicationRules["d2"] }) {
  const signals = listOf(doc.editor.value(["signals"]));
  const enabled = ["B1I", "B2I", "B3I"].some((signal) => signals.includes(signal));
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {!enabled ? <p className="m-0 text-small text-ink2">Select B1I, B2I or B3I to use D2 augmentation.</p> : null}
      <OptionalBlock doc={doc} path={[...path, "integrity"]} label="Integrity and corrections" create={() => ({ satellites: [] })}>
        <WordSelect doc={doc.editor} path={[...path, "integrity", "check"]} label="Satellite integrity check" />
        <SatelliteQuality key={`${doc.id}:${pathKey(doc.kind, path)}`} doc={doc} path={[...path, "integrity", "satellites"]} maximum={rules.maxSatellites} />
      </OptionalBlock>
      <OptionalBlock doc={doc} path={[...path, "grid"]} label="Ionosphere grid declaration" create={() => ({})}>
        <GridDeclaration doc={doc} path={[...path, "grid"]} count={rules.gridCount} />
      </OptionalBlock>
    </div>
  );
}

function GridDeclaration({ doc, path, count }: { doc: ScenarioDoc; path: Path; count: number }) {
  const giveiPath = [...path, "givei"];
  const current = doc.editor.value(giveiPath);
  const list = Array.isArray(current) ? current : null;
  const uniform = list === null || list.length === 1;
  const fieldPath = list !== null && uniform ? [...giveiPath, 0] : giveiPath;
  const entryMeta = useSchema(doc.editor, [...giveiPath, 0]).node;
  const setMode = (mode: string) => {
    runDocumentEdit({ kind: "scenario", id: doc.id }, () => editPublication(doc, () => {
      const value = doc.editor.value(giveiPath);
      const values = Array.isArray(value) ? value : [value];
      const first = values.find((entry) => typeof entry === "number");
      const grid = Array.from({ length: count }, (_, index) => values[index] ?? (values.length === 1 ? first : undefined) ?? null);
      return [{ path: giveiPath, value: mode === "uniform" ? first : grid }];
    }));
  };
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="grid grid-cols-1 gap-3">
        <WordSelect doc={doc.editor} path={[...path, "check"]} label="Grid integrity check" />
        <Field label="GIVE index assignment" path={pathKey(doc.kind, giveiPath)}>
          <Select aria-label="GIVE index assignment" value={uniform ? "uniform" : "grid"} onChange={(event) => setMode(event.target.value)}>
            <option value="uniform">Same index for all points</option>
            <option value="grid">Individual grid points</option>
          </Select>
        </Field>
      </div>
      {uniform ? (
        <NumberField doc={doc.editor} path={fieldPath} label="GIVEI for all grid points" unit="index" />
      ) : (
        <IndexedTable doc={doc} path={giveiPath} label="Grid point GIVEI" count={count} firstIndex={1} min={entryMeta?.minimum} max={entryMeta?.maximum} unit="index" />
      )}
      <SatelliteSetField doc={doc} path={[...path, "notMonitored"]} label="Grid points not monitored" min={1} max={count} allowEmpty hint={`IDs 1–${count}; no duplicates.`} />
    </div>
  );
}

function SatelliteQuality({ doc, path, maximum }: { doc: ScenarioDoc; path: Path; maximum: number }) {
  const table = useTable(doc, path, true);
  const { rows, selected, column } = table;
  const meta = useSchema(doc.editor, [...path, 0, column]).node;
  const svidMeta = useSchema(doc.editor, [...path, 0, "svid"]).node;
  const svidRange = svidMeta?.anyOf?.find((node) => node.type === "integer") ?? svidMeta?.items ?? svidMeta;
  const firstSvid = svidRange?.minimum;
  const lastSvid = svidRange?.maximum;
  const used = new Set(rows.flatMap((row) => listOf(recordOf(row)?.svid)).filter((value) => typeof value === "number"));
  const add = () => runDocumentEdit({ kind: "scenario", id: doc.id }, () => editPublication(doc, () => {
    if (firstSvid === undefined || lastSvid === undefined) return [];
    const current = listOf(doc.editor.value(path));
    const taken = new Set(current.flatMap((row) => listOf(recordOf(row)?.svid)));
    return taken.size >= maximum ? [] : [{ path, value: [...current, { svid: [] }] }];
  }));
  const remove = (index: number) => {
    if (table.apply((current) => [{ path, value: current.filter((_, row) => row !== index) }])) table.setSelected(new Set());
  };
  return (
    <div className="flex min-w-0 flex-col gap-2" data-path={pathKey(doc.kind, path)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="lab text-ink2" title="A row shares quality indices across its satellites. Without corrections, UDRE is 15.">Satellite quality</span>
        <span className={used.size > maximum ? "text-small text-fault" : "text-small text-ink3"}><Fig>{`${used.size} / ${maximum} satellites`}</Fig></span>
        <span className="flex-auto" />
        <Button size="xs" icon="plus" disabled={used.size >= maximum || firstSvid === undefined || lastSvid === undefined} onClick={add}>Add satellite</Button>
      </div>
      {rows.length > 0 || table.conflict !== null ? <TableControls doc={doc} path={path} table={table} label="Quality index" min={meta?.minimum} max={meta?.maximum} column={column}>
        <Field label="Quality index">
          <Select aria-label="Quality index to set" value={column} onChange={(event) => doc.editing.setTable(path, { qualityColumn: event.target.value === "udrei" ? "udrei" : event.target.value === "rurai" ? "rurai" : "" })}>
            <option value="">Choose an index</option>
            <option value="rurai">RURA index</option>
            <option value="udrei">UDRE index</option>
          </Select>
        </Field>
      </TableControls> : null}
      {rows.length === 0 ? <p className="m-0 text-small text-ink3">No satellites</p> : (
        <div className="flex max-h-[420px] min-w-0 flex-col divide-y divide-line overflow-y-auto overscroll-contain rounded-key border border-line">
          {rows.map((_, index) => (
            <div key={index} role="group" aria-label={`Satellite quality row ${index + 1}`} className={`flex min-w-0 shrink-0 flex-col gap-2 p-3 ${selected.has(index) ? "bg-face" : ""}`} data-path={pathKey(doc.kind, [...path, index])}>
              <div className="flex items-center justify-between gap-2">
                <label className="inline-flex min-w-0 items-center gap-2 text-small text-ink2">
                  <input type="checkbox" aria-label={`Select quality row ${index + 1}`} checked={selected.has(index)} onChange={(event) => table.toggle(index, event.target.checked)} />
                  <Fig>{`Row ${index + 1}`}</Fig>
                </label>
                <Button size="xs" variant="ghost" icon="x" iconOnly aria-label={`Remove quality row ${index + 1}`} onClick={() => remove(index)} />
              </div>
              <SatelliteSetField doc={doc} path={[...path, index, "svid"]} label="BDS satellites" min={firstSvid} max={lastSvid} singleOrArray allowEmpty />
              <div className="grid min-w-0 grid-cols-2 gap-2">
                <NumberField doc={doc.editor} path={[...path, index, "rurai"]} label="RURA index" unit="" />
                <NumberField doc={doc.editor} path={[...path, index, "udrei"]} label="UDRE index" unit="" />
              </div>
            </div>
          ))}
        </div>
      )}
      <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, path, "self")} />
    </div>
  );
}
