"use client";

import { displayOrder, systems } from "@/model/gnss";
import { fixed, listOf, numberOf, recordOf, useStore } from "@/core";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import { schemas } from "@/workbench/schemas";
import { systemsOf, words } from "@/model/schema";
import { appendCollectionItem, removeCollectionItem } from "@/model/scenario";
import { Button, Fig, Icon } from "@/page/shared/ui";
import { Field, Messages, NumberField, WordSelect } from "@/page/shared/documents/editor";
import { diagnosticsAt } from "@/model/document";
import { OptionalBlock, SatelliteSetField } from "@/page/workspace/resource/scenario/editor/fields";
import { Readout, signalList } from "../parts";
import { changeDocument } from "@/workbench/documents/editing";
import { ScenarioGroup } from "../../group";
import { PowerSection } from "./power";

export function SignalsSection({ doc }: { doc: ScenarioDoc }) {
  return <div className="flex min-w-0 flex-col gap-4">
    <AllocationSection doc={doc} />
    <ScenarioGroup doc={doc} title="Power" paths={[["power"]]}><PowerSection doc={doc} /></ScenarioGroup>
  </div>;
}

export function AllocationSection({ doc }: { doc: ScenarioDoc }) {
  const scenario = useStore(schemas, (s) => s.scenario);
  const signalsNode = scenario?.properties?.signals ?? null;
  const all = words(signalsNode);
  const systemOf = systemsOf(signalsNode);
  const on = new Set(signalList(doc));
  const warned = new Set(doc.editor.diagnostics.filter((d) => d.path === "signals" && !d.error).map((d) => d.message.split(" ")[0]));
  const format = doc.editor.value(["samples", "format"]);
  const rate = numberOf(doc.editor.value(["samples", "sampleFreq"]));
  const centre = numberOf(doc.editor.value(["samples", "centerFreq"]));
  const toggle = (signal: string) => changeDocument(doc, () => {
    const current = signalList(doc);
    const next = current.includes(signal) ? current.filter((s) => s !== signal) : [...current, signal];
    doc.editor.write(["signals"], all.filter((s) => next.includes(s)));
  });
  return (
    <>
      <ScenarioGroup doc={doc} title="Constellations and signals" paths={[["signals"], ["elevationMask"]]} summary={`${on.size} signals selected`}>
        <div className="flex min-w-0 flex-col gap-2" data-path="scenario:signals">
          <div className="flex flex-col gap-1">
            {displayOrder.map((system) => (
              <div key={system} className="grid grid-cols-[64px_minmax(0,1fr)] items-start gap-1 py-1">
                <span className="lab pt-1.5 text-ink2">{system}</span>
                <div className="flex flex-wrap gap-1">
                  {all
                    .filter((s) => systemOf[s] === system)
                    .map((s) => (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={on.has(s)}
                        onClick={() => toggle(s)}
                        className={`inline-flex h-7 items-center gap-1 rounded-key px-2 text-small font-medium ${on.has(s) ? (warned.has(s) ? "bg-face text-warn-ink shadow-[inset_0_0_0_2px_var(--warn)]" : "bg-sel text-on-sel") : "bg-face text-ink2 ring-key hover:bg-hover"}`}
                      >
                        {on.has(s) ? <Icon name="check" size={12} /> : null}
                        {s}
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </div>
          <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, ["signals"])} />
        </div>
        <NumberField doc={doc.editor} path={["elevationMask"]} label="Elevation mask" />
      </ScenarioGroup>
      <ScenarioGroup doc={doc} title="Sample stream" paths={[["samples"]]}>
        <OptionalBlock doc={doc} path={["samples"]} label="Generate sample stream" title="Observation and position outputs do not require samples." create={() => ({})} toggle>
          <WordSelect doc={doc.editor} path={["samples", "format"]} label="Sample format" />
        {format !== "IQ16" ? (
          <Field label="RF stream" path="scenario:samples.format">
            <div className="flex flex-wrap items-center gap-2 rounded-key p-2 text-small text-ink2 ring-key">
              <b className="font-semibold text-ink2">{typeof format === "string" ? format : "Not set"}</b>
              <span>Radio hosts require IQ16.</span>
              <span className="flex-auto" />
              <Button size="xs" onClick={() => changeDocument(doc, () => doc.editor.write(["samples", "format"], "IQ16"))}>
                Use IQ16
              </Button>
            </div>
          </Field>
        ) : null}
        <div className="grid grid-cols-1 gap-3">
            <NumberField doc={doc.editor} path={["samples", "sampleFreq"]} label="Sample rate" unit="Msps" />
            <NumberField doc={doc.editor} path={["samples", "centerFreq"]} label="Centre frequency" />
        </div>
        {rate !== null && centre !== null ? (
          <Readout>
            <span>
              Band{" "}
              <b className="font-medium text-ink">
                <Fig>{`${fixed(centre - rate / 2, 3)}–${fixed(centre + rate / 2, 3)} MHz`}</Fig>
              </b>
            </span>
          </Readout>
        ) : null}
        </OptionalBlock>
      </ScenarioGroup>
      <ScenarioGroup doc={doc} title="Satellite exclusions" paths={[["maskOut"]]} advanced configured={listOf(doc.editor.value(["maskOut"])).length}>
        <MaskOut doc={doc} />
      </ScenarioGroup>
    </>
  );
}

function MaskOut({ doc }: { doc: ScenarioDoc }) {
  const root = useStore(schemas, (s) => s.scenario);
  const source = doc.editor.value(["maskOut"]);
  const rows = listOf(source).map((r) => recordOf(r) ?? {});
  return (
    <div className="flex min-w-0 flex-col gap-1" data-path="scenario:maskOut">
      {rows.map((r, i) => {
        const path = Array.isArray(source) ? ["maskOut", i] : ["maskOut"];
        const capacity = typeof r.system === "string" ? root?.["x-satellite-capacity"]?.[r.system] : undefined;
        return (
          <div key={i} className="grid grid-cols-[96px_minmax(0,1fr)_auto] items-start gap-2 border-t border-line py-2">
            <WordSelect doc={doc.editor} path={[...path, "system"]} words={[...systems]} label="System" />
            <SatelliteSetField
              doc={doc}
              path={[...path, "svid"]}
              label="Masked satellites"
              min={1}
              max={capacity}
              allowEmpty
              singleOrArray
              hint="Leave empty to exclude none."
            />
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon="x"
              className="mt-5 h-8"
              aria-label={`Remove mask group ${i + 1}`}
              onClick={() => changeDocument(doc, () => doc.editor.writeMany(removeCollectionItem(["maskOut"], doc.editor.value(["maskOut"]), i)))}
            />
          </div>
        );
      })}
      <div className="flex h-8 items-center">
        <Button size="xs" icon="plus" onClick={() => changeDocument(doc, () => doc.editor.writeMany(appendCollectionItem(["maskOut"], doc.editor.value(["maskOut"]), doc.editor.raw(["maskOut"]), { svid: [] })))}>
          Add group
        </Button>
      </div>
      <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, ["maskOut"])} />
    </div>
  );
}
