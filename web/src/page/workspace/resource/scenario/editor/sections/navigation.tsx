"use client";

import { displayOrder } from "@/model/gnss";
import { Field, Messages, WordSelect } from "@/page/shared/documents/editor";
import { diagnosticsAt } from "@/model/document";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import { FileChips } from "./navigation/files";
import { IonosphereFields } from "./navigation/ionosphere";
import { ScenarioGroup } from "../group";
import { OptionalBlock } from "../fields";

export function NavSection({ doc }: { doc: ScenarioDoc }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ScenarioGroup doc={doc} title="Ephemeris" paths={[["ephemeris"]]}>
        <div data-path="scenario:ephemeris"><FileChips doc={doc} keyName="ephemeris" multiple /></div>
      </ScenarioGroup>
      <ScenarioGroup doc={doc} title="Supporting data" paths={[["almanac"], ["antenna"]]} advanced configured={doc.references("almanac").length + doc.references("antenna").length}>
        <Field label="Almanac" path="scenario:almanac">
          <FileChips doc={doc} keyName="almanac" multiple />
        </Field>
        <Field label="Antenna" path="scenario:antenna">
          <FileChips doc={doc} keyName="antenna" accept=".atx" multiple={false} />
        </Field>
      </ScenarioGroup>
      <ScenarioGroup doc={doc} title="Ionosphere" paths={[["ionosphere"]]}>
        <IonosphereFields doc={doc} />
      </ScenarioGroup>
      <ScenarioGroup doc={doc} title="Precise products" paths={[["precise"]]} advanced>
        <OptionalBlock doc={doc} path={["precise"]} label="Include precise products" create={() => ({ orbit: [] })} toggle>
          <FileChips doc={doc} keyName="precise" />
          <div className="grid grid-cols-1 gap-3">
            {displayOrder.map((system) => <WordSelect key={system} doc={doc.editor} path={["precise", "clockReference", system]} label={`${system} clock reference`} />)}
          </div>
        </OptionalBlock>
        <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, ["precise"])} />
      </ScenarioGroup>
    </div>
  );
}
