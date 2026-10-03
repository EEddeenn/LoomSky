"use client";

import type { ScenarioDoc } from "@/workbench/documents/scenario";
import { JsonValueField, TextField } from "@/page/shared/documents/editor";
import { TrajectoryBinding } from "./setup/trajectory";
import { WindowSection } from "./setup/window";
import { ScenarioGroup } from "../group";

export function SetupSection({ doc }: { doc: ScenarioDoc }) {
  const description = doc.editor.value(["description"]);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ScenarioGroup doc={doc} title="Scenario" paths={[["name"], ["description"]]}>
        <TextField doc={doc.editor} path={["name"]} label="Name" />
        {description !== undefined && typeof description !== "string" ? (
          <JsonValueField doc={doc.editor} path={["description"]} label="Description" />
        ) : (
          <TextField doc={doc.editor} path={["description"]} label="Description" multiline />
        )}
      </ScenarioGroup>
      <ScenarioGroup doc={doc} title="Time window" paths={[["time"], ["duration"]]}>
        <WindowSection doc={doc} />
      </ScenarioGroup>
      <TrajectoryBinding doc={doc} />
    </div>
  );
}
