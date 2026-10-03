"use client";

import { listOf, recordOf, useStore } from "@/core";
import { systems } from "@/model/gnss";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import { schemas } from "@/workbench/schemas";
import type { Path } from "@/model/schema";
import { appendCollectionItem, collectionItemPath, removeCollectionItem } from "@/model/scenario";
import { Button } from "@/page/shared/ui";
import { BoolToggle, Field, Messages, NumberField, NumberInput, Select, useSchema, WordSelect } from "@/page/shared/documents/editor";
import { diagnosticsAt, pathKey } from "@/model/document";
import { SatelliteSetField } from "@/page/workspace/resource/scenario/editor/fields";
import { canInspectScenarioTime, inspectScenarioTime } from "@/workbench/documents/scenario/actions";
import { changeDocument } from "@/workbench/documents/editing";
import { useCollectionSelection } from "@/workbench/documents/scenario/editing";
import { CollectionEditor } from "../../collection";

function problemAt(doc: ScenarioDoc, path: Path): "error" | "warning" | null {
  const diagnostics = diagnosticsAt(doc.editor, path);
  return diagnostics.some((diagnostic) => diagnostic.error) ? "error" : diagnostics.length > 0 ? "warning" : null;
}

function targets(value: unknown): string {
  const row = recordOf(value);
  const system = typeof row?.system === "string" ? row.system : "System not set";
  const satellites = listOf(row?.svid);
  return `${system} · ${satellites.length === 0 || satellites.includes(0) ? "All satellites" : satellites.join(", ")}`;
}

function eventTime(value: unknown): number | null {
  const time = recordOf(value)?.time;
  return time === undefined ? 0 : typeof time === "number" && Number.isFinite(time) ? time * 1000 : null;
}

function eventAction(value: unknown): string {
  const event = recordOf(value);
  if (event?.value === undefined) return "Restore default and fade";
  const unit = event.unit ?? "dBHz";
  return `${event.value} ${unit === "dBHz" ? "dB-Hz" : unit}`;
}

function appendItem(doc: ScenarioDoc, path: Path, value: unknown): number {
  const current = doc.editor.value(path);
  const count = listOf(current).length;
  doc.editor.writeMany(appendCollectionItem(path, current, doc.editor.raw(path), value));
  return count;
}

function removeItem(doc: ScenarioDoc, path: Path, index: number): void {
  const current = doc.editor.value(path);
  doc.editor.writeMany(removeCollectionItem(path, current, index));
  doc.editing.selectCollection(path, Math.max(0, index - 1));
}

export function PowerSection({ doc }: { doc: ScenarioDoc }) {
  const power = useSchema(doc.editor, ["power", "initPower", "value"]);
  const path: Path = ["power", "signalPower"];
  const schedule = doc.editor.value(path);
  const rows = listOf(schedule);
  const [selected, select] = useCollectionSelection(doc, path, rows.length);
  const selectedPath = collectionItemPath(path, schedule, selected);
  return (
    <>
      <div className="grid grid-cols-1 gap-3">
        <NumberField doc={doc.editor} path={["power", "noiseFloor"]} label="Noise floor" />
        <Field label="Default power" htmlFor="power-level" path="scenario:power.initPower" status={power.source}>
          <div className="flex min-w-0">
            <div className="min-w-0 flex-1 [&_input]:rounded-r-none">
              <NumberInput doc={doc.editor} path={["power", "initPower", "value"]} unit="" id="power-level" />
            </div>
            <div className="-ml-px w-[88px] flex-none">
              <WordSelect doc={doc.editor} path={["power", "initPower", "unit"]} flat aria="Default power unit" />
            </div>
          </div>
          <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, ["power", "initPower"])} />
        </Field>
      </div>
      <BoolToggle doc={doc.editor} path={["power", "elevationAdjust"]}>Fade with elevation</BoolToggle>
      <div className="flex min-w-0 flex-col gap-3 border-t border-line pt-4" data-path={pathKey(doc.kind, path)}>
        <CollectionEditor
          label="Power target groups"
          items={rows.map((row, index) => ({
            label: targets(row),
            summary: `${listOf(recordOf(row)?.powerValue).length} events`,
            problem: problemAt(doc, collectionItemPath(path, schedule, index)),
          }))}
          selected={selected}
          onSelect={select}
          empty="No events. Using default power and elevation fade."
          actions={<Button size="xs" icon="plus" onClick={() => changeDocument(doc, () => doc.editing.selectCollection(path, appendItem(doc, path, { powerValue: [{}] })))}>Add group</Button>}
          detailPath={pathKey(doc.kind, selectedPath)}
          detailTitle={`Target group ${selected + 1}`}
          detailActions={<Button variant="ghost" size="xs" icon="x" onClick={() => changeDocument(doc, () => removeItem(doc, path, selected))}>Remove group</Button>}
        >
          <PowerGroup doc={doc} path={selectedPath} />
        </CollectionEditor>
        <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, path, "self")} />
      </div>
    </>
  );
}

function PowerGroup({ doc, path }: { doc: ScenarioDoc; path: Path }) {
  const root = useStore(schemas, (s) => s.scenario);
  const system = doc.editor.value([...path, "system"]);
  const capacity = typeof system === "string" ? root?.["x-satellite-capacity"]?.[system] : undefined;
  const valuesPath = [...path, "powerValue"];
  const schedule = doc.editor.value(valuesPath);
  const values = listOf(schedule);
  const [selected, select] = useCollectionSelection(doc, valuesPath, values.length);
  const selectedPath = collectionItemPath(valuesPath, schedule, selected);
  return (
    <>
      <WordSelect doc={doc.editor} path={[...path, "system"]} words={[...systems]} label="System" />
      <SatelliteSetField
        doc={doc}
        path={[...path, "svid"]}
        label="Satellites"
        min={0}
        max={capacity}
        allowEmpty
        singleOrArray
        allLabel="All satellites"
        enforceAllExclusive
        hint="Use 0 or leave empty for all satellites. Separate numbers or ranges with commas."
      />
      <CollectionEditor
        label="Power events"
        items={values.map((event, index) => {
          const time = eventTime(event);
          return {
            label: time === null ? "Invalid time" : `T+${time / 1000} s`,
            detail: eventAction(event),
            problem: problemAt(doc, collectionItemPath(valuesPath, schedule, index)),
          };
        })}
        selected={selected}
        onSelect={select}
        empty="No events"
        actions={<Button size="xs" icon="plus" onClick={() => changeDocument(doc, () => doc.editing.selectCollection(valuesPath, appendItem(doc, valuesPath, {})))}>Add event</Button>}
        detailPath={pathKey(doc.kind, selectedPath)}
        detailTitle={`Event ${selected + 1}`}
        detailActions={<Button size="xs" variant="ghost" iconOnly icon="x" aria-label={`Remove event ${selected + 1}`} onClick={() => changeDocument(doc, () => removeItem(doc, valuesPath, selected))} />}
      >
        <PowerEvent doc={doc} path={selectedPath} ordinal={selected + 1} />
      </CollectionEditor>
      <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, path, "self")} />
    </>
  );
}

function PowerEvent({ doc, path, ordinal }: { doc: ScenarioDoc; path: Path; ordinal: number }) {
  const isDefault = doc.editor.value([...path, "value"]) === undefined;
  const init = recordOf(doc.editor.value(["power", "initPower"]));
  const time = eventTime(doc.editor.value(path));
  const inspectable = canInspectScenarioTime(doc, time);
  return (
    <>
      <Button size="xs" disabled={!inspectable} title={inspectable ? "Preview this event" : "Check the scenario first"} onClick={() => inspectScenarioTime(doc, time)}>Inspect time</Button>
      <NumberField doc={doc.editor} path={[...path, "time"]} label="Time from start" />
      <Field label="Action">
        <Select
          aria-label={`Event ${ordinal} action`}
          value={isDefault ? "default" : "level"}
          onChange={(e) => changeDocument(doc, () =>
            e.target.value === "default"
              ? doc.editor.write([...path, "value"], undefined)
              : doc.editor.writeMany([
                  { path: [...path, "value"], value: init?.value ?? null },
                  { path: [...path, "unit"], value: init?.unit },
                ]),
          )}
        >
          <option value="level">Set power level</option>
          <option value="default">Restore default and fade</option>
        </Select>
      </Field>
      {!isDefault ? (
        <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-3">
          <NumberField doc={doc.editor} path={[...path, "value"]} label="Level" />
          <WordSelect doc={doc.editor} path={[...path, "unit"]} label="Unit" />
        </div>
      ) : null}
      <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, path)} />
    </>
  );
}
