"use client";

import type { ScenarioDoc } from "@/workbench/documents/scenario";
import { JsonValueField, Messages } from "@/page/shared/documents/editor";
import { PayloadsSection } from "./messages/payloads";
import { ServicesSection } from "./messages/services";
import { ScenarioGroup } from "../group";

export function MessagesSection({ doc }: { doc: ScenarioDoc }) {
  const unknown = doc.editor.diagnostics.filter((d) => d.code === "unknown_key");
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ScenarioGroup doc={doc} title="Services" paths={[["has"], ["pppB2b"]]}>
        <ServicesSection doc={doc} />
      </ScenarioGroup>
      <ScenarioGroup doc={doc} title="Publications" paths={[["messages"]]}>
        <PayloadsSection doc={doc} />
      </ScenarioGroup>
      <ScenarioGroup doc={doc} title="Source metadata" paths={[["version"]]} advanced>
        <JsonValueField doc={doc.editor} path={["version"]} label="Source JSON version" />
      </ScenarioGroup>
      {unknown.length > 0 ? (
        <ScenarioGroup doc={doc} title="Other keys" paths={[]} advanced diagnostics={unknown} configured={new Set(unknown.map((diagnostic) => diagnostic.path)).size}>
          <Messages doc={doc.editor} diagnostics={unknown} />
        </ScenarioGroup>
      ) : null}
    </div>
  );
}
