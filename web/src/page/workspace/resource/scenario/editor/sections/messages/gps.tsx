"use client";

import { listOf } from "@/core";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import type { Path } from "@/model/schema";
import { NumberField, useSchema, WordSelect } from "@/page/shared/documents/editor";
import { IndexedTable, OptionalBlock, PayloadTextField, SatelliteSetField, TimeField } from "@/page/workspace/resource/scenario/editor/fields";
import type { PublicationRules } from "@/model/scenario";
import { referenceTime } from "@/workbench/documents/scenario/editing";

export function GpsPublication({ doc, path, rules }: { doc: ScenarioDoc; path: Path; rules: PublicationRules["gps"] }) {
  const signals = listOf(doc.editor.value(["signals"]));
  const enabled = ["L1CA", "L1C", "L2C", "L5"].some((signal) => signals.includes(signal));
  const configurationMeta = useSchema(doc.editor, [...path, "configuration", 0]).node;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {!enabled ? <p className="m-0 text-small text-ink2">Select a GPS signal to use these publications.</p> : null}
      <OptionalBlock doc={doc} path={[...path, "integrity"]} label="Integrity flags" title="LNAV, CNAV and CNAV-2." create={() => ({})}>
        <div className="grid grid-cols-1 gap-3">
          <NumberField doc={doc.editor} path={[...path, "integrity", "isf"]} label="Integrity status flag" />
          <SatelliteSetField doc={doc} path={[...path, "integrity", "alert"]} label="Alert PRNs" allowEmpty singleOrArray />
        </div>
      </OptionalBlock>
      <OptionalBlock doc={doc} path={[...path, "text"]} label="Broadcast text" title="LNAV, CNAV and CNAV-2." create={() => ""}>
        <PayloadTextField doc={doc} path={[...path, "text"]} label="Text message" kind="broadcast" />
      </OptionalBlock>
      <OptionalBlock doc={doc} path={[...path, "configuration"]} label="SV configuration codes" title="LNAV and CNAV-2. Omit to use satellite allocation at run start." create={() => Array.from({ length: rules.configurationCount }, () => null)}>
        <IndexedTable doc={doc} path={[...path, "configuration"]} label="SV configuration" count={rules.configurationCount} firstIndex={1} min={configurationMeta?.minimum} max={configurationMeta?.maximum} unit="index" />
      </OptionalBlock>
      <OptionalBlock
        doc={doc}
        path={[...path, "ism"]}
        label="Integrity support message"
        title="CNAV and CNAV-2."
        create={() => ({ reference: referenceTime(doc, path, "GPS", rules.ismGridMs), satellites: [] })}
      >
        <GpsIsm doc={doc} path={[...path, "ism"]} rules={rules} />
      </OptionalBlock>
      <OptionalBlock doc={doc} path={[...path, "differential"]} label="Differential correction accuracy" title="CNAV and CNAV-2." create={() => ({})}>
        <div className="grid grid-cols-2 gap-3">
          <NumberField doc={doc.editor} path={[...path, "differential", "udra"]} label="UDRA" unit="index" />
          <NumberField doc={doc.editor} path={[...path, "differential", "udraRate"]} label="UDRA rate" unit="index" />
        </div>
      </OptionalBlock>
    </div>
  );
}

function GpsIsm({ doc, path, rules }: { doc: ScenarioDoc; path: Path; rules: PublicationRules["gps"] }) {
  const value = doc.editor.value([...path, "constellation"]);
  const range = typeof value === "string" ? rules.identifiers[value] : undefined;
  const satelliteMeta = useSchema(doc.editor, [...path, "satellites"]).node?.items;
  const indexFields = [["tCorrel", "Correlation time"], ["bNom", "Nominal bias"], ["gammaNom", "Nominal gamma"], ["rSat", "Satellite fault rate"], ["pConst", "Constellation fault probability"], ["mfd", "Mean fault duration"]] as const;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <TimeField doc={doc} path={[...path, "reference"]} label="Reference time" hint={`Use the ${rules.ismGridMs / 3_600_000}-hour GPS time grid.`} />
      <div className="grid grid-cols-1 gap-3">
        <WordSelect doc={doc.editor} path={[...path, "constellation"]} label="Constellation" />
        <WordSelect doc={doc.editor} path={[...path, "service"]} label="Service level" />
      </div>
      <SatelliteSetField
        doc={doc}
        path={[...path, "satellites"]}
        label="Satellites described"
        min={range?.first ?? satelliteMeta?.minimum}
        max={range === null ? -1 : range?.last ?? satelliteMeta?.maximum}
        allowEmpty
        hint={range === null ? "Unavailable constellation requires an empty set." : range === undefined ? undefined : `IDs ${range.first}–${range.last}; may be empty.`}
      />
      <div className="grid grid-cols-2 gap-3">
        {indexFields.map(([key, label]) => <NumberField key={key} doc={doc.editor} path={[...path, key]} label={label} unit="index" />)}
      </div>
    </div>
  );
}
