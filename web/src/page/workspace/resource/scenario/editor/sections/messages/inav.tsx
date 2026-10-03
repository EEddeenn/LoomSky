"use client";

import { listOf } from "@/core";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import type { Path } from "@/model/schema";
import { Select } from "@/page/shared/documents/editor";
import { Field, Messages, NumberField, useSchema } from "@/page/shared/documents/editor";
import { diagnosticsAt, pathKey } from "@/model/document";
import { PayloadTextField, SatelliteSetField, TimeField } from "@/page/workspace/resource/scenario/editor/fields";
import type { PublicationRules } from "@/model/scenario";
import { changeInavService } from "@/workbench/documents/scenario/editing";
import { runDocumentEdit } from "@/workbench/documents/editing";

export function InavPublication({ doc, path, rules }: { doc: ScenarioDoc; path: Path; rules: PublicationRules["inav"] }) {
  const ismPath = [...path, "ism"];
  const servicePath = [...ismPath, "service"];
  const current = doc.editor.value(servicePath);
  const service = typeof current === "string" ? current : "";
  const meta = useSchema(doc.editor, servicePath);
  const services = (meta.node?.enum ?? []).filter((value) => typeof value === "string");
  const satelliteMeta = useSchema(doc.editor, [...ismPath, "satellites"]).node?.items;
  const signals = listOf(doc.editor.value(["signals"]));
  const enabled = ["E1", "E5b"].some((signal) => signals.includes(signal));
  const indexFields = [["pConst", "Constellation fault probability"], ["pSat", "Satellite fault probability"], ["ura", "URA"], ["ure", "URE"], ["bNom", "Nominal bias"], ["tValidity", "Validity"]] as const;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {!enabled ? <p className="m-0 text-small text-ink2">Select E1 or E5b to use I/NAV publications.</p> : null}
      <Field label="ISM service" path={pathKey(doc.kind, servicePath)}>
        <Select
          aria-label="ISM service"
          title={service === "noData" ? "No integrity support data for this interval." : meta.description}
          value={service}
          onChange={(event) => runDocumentEdit({ kind: "scenario", id: doc.id }, () => changeInavService(doc, path, event.target.value, rules))}
        >
          {!services.includes(service) ? <option value={service}>{service || "Choose a service"}</option> : null}
          {services.map((value) => <option key={value} value={value}>{value}</option>)}
        </Select>
        <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, servicePath)} />
      </Field>
      {service === "test" ? <PayloadTextField doc={doc} path={[...ismPath, "testMessage"]} label="Test payload · 87 bits" kind="hex87" /> : null}
      {service === "horizontal" ? (
        <>
          <TimeField doc={doc} path={[...ismPath, "reference"]} label="Reference time" hint={`Use the ${rules.referenceGridMs / 60_000}-minute GST grid.`} />
          <SatelliteSetField
            doc={doc}
            path={[...ismPath, "satellites"]}
            label="Satellites described"
            min={satelliteMeta?.minimum}
            max={satelliteMeta?.maximum}
            allowEmpty
            bankSize={rules.bankSize}
            hint={`Use one bank: 1–${rules.bankSize} or ${rules.bankSize + 1}–${satelliteMeta?.maximum ?? "the last satellite"}; may be empty.`}
          />
          <div className="grid grid-cols-2 gap-3">
            {indexFields.map(([key, label]) => <NumberField key={key} doc={doc.editor} path={[...ismPath, key]} label={label} unit="index" />)}
          </div>
        </>
      ) : null}
    </div>
  );
}
