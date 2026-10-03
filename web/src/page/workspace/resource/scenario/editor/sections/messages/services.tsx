"use client";

import { recordOf } from "@/core";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import { Toggle } from "@/page/shared/ui";
import { Field, Messages, NumberField, WordSelect } from "@/page/shared/documents/editor";
import { diagnosticsAt } from "@/model/document";
import { signalList } from "../parts";
import { changeDocument } from "@/workbench/documents/editing";

export function ServicesSection({ doc }: { doc: ScenarioDoc }) {
  return (
    <div className="flex flex-col gap-5">
      <Service doc={doc} name="has" title="Galileo HAS" signal="E6" />
      <Service doc={doc} name="pppB2b" title="BDS PPP-B2b" signal="B2b" />
    </div>
  );
}

function Service({ doc, name, title, signal }: { doc: ScenarioDoc; name: "has" | "pppB2b"; title: string; signal: string }) {
  const block = recordOf(doc.editor.value([name]));
  const enabled = block !== undefined && block.enable !== false;
  const signals = signalList(doc);
  const active = signals.includes(signal);
  return (
    <Field label={title} path={`scenario:${name}`}>
      <Toggle checked={enabled} title={name === "pppB2b" ? "Corrections use BDS-3 GEO satellites." : "Corrections use Galileo E6 C/NAV pages."} onChange={(on) => changeDocument(doc, () => doc.editor.write([name, "enable"], on))}>
        Enable on {signal}
      </Toggle>
      {!enabled || doc.editor.value(["samples"]) === undefined || !active ? <p className="m-0 text-small text-ink3">
        {!enabled ? "Disabled; intervals retained."
          : doc.editor.value(["samples"]) === undefined ? "Enable samples to transmit this service."
          : `Select ${signal} in Signals to transmit.`}
      </p> : null}
      {block !== undefined ? (
        <div className="mt-1 grid grid-cols-1 gap-3">
          {name === "has" ? <WordSelect doc={doc.editor} path={[name, "status"]} label="Status" /> : null}
          <NumberField doc={doc.editor} path={[name, "clockInterval"]} label="Clock interval" />
          <NumberField doc={doc.editor} path={[name, "orbitInterval"]} label="Orbit interval" />
        </div>
      ) : null}
      <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, [name])} />
    </Field>
  );
}
