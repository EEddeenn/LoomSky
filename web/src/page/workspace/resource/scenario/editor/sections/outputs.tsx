"use client";

import { stringOf } from "@/core";
import { reportProblem, resolveProblem } from "@/workbench/feedback";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import { TruthButtons } from "@/page/shared/preview/outputs";
import { captureAttention } from "@/workbench/navigation";
import { reportPendingIssue } from "@/workbench/documents/editing";
import { operationSourceKey, startExport } from "@/workbench/operations";
import { Messages, NumberField, WordSelect } from "@/page/shared/documents/editor";
import { diagnosticsAt } from "@/model/document";
import { ScenarioGroup } from "../group";
import { OptionalBlock } from "../fields";

export function OutputsSection({ doc }: { doc: ScenarioDoc }) {
  const observation = doc.editor.value(["observation"]);
  const position = doc.editor.value(["position"]);
  const positionFormat = stringOf(doc.editor.value(["position", "format"]))?.toLowerCase() ?? "position";
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ScenarioGroup doc={doc} title="Observation" paths={[["observation"]]} summary="RINEX 3.04">
        <OptionalBlock doc={doc} path={["observation"]} label="Include observation output" create={() => ({})} toggle>
          <NumberField doc={doc.editor} path={["observation", "interval"]} label="Interval" />
        </OptionalBlock>
        <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, ["observation"], "self")} />
      </ScenarioGroup>
      <ScenarioGroup doc={doc} title="Position" paths={[["position"]]}>
        <OptionalBlock doc={doc} path={["position"]} label="Include position output" create={() => ({})} toggle>
          <WordSelect doc={doc.editor} path={["position", "format"]} label="Format" />
          <NumberField doc={doc.editor} path={["position", "interval"]} label="Interval" />
        </OptionalBlock>
        <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, ["position"], "self")} />
      </ScenarioGroup>
      {observation !== undefined || position !== undefined ? (
        <ScenarioGroup doc={doc} title="Download predictions" paths={[]} summary="Full scenario window.">
          <TruthButtons
            id={doc.id}
            outputs={{ observation: observation !== undefined, position: position === undefined ? null : positionFormat }}
            request={{ kind: "scenario-truth", resource: { kind: "scenario", id: doc.id }, name: doc.name, incarnation: operationSourceKey(doc), snapshot: doc.workingSnapshot }}
            onStart={(format) => {
              try {
                const issue = doc.prepareSnapshot();
                if (issue !== null) {
                  reportPendingIssue({ kind: "scenario", id: doc.id }, issue, captureAttention());
                  return;
                }
                resolveProblem(`scenario:${doc.id}:prediction-preparation`);
                startExport({ kind: "scenario-truth", resource: { kind: "scenario", id: doc.id }, name: doc.name, incarnation: operationSourceKey(doc), snapshot: doc.workingSnapshot, format });
              } catch (error) {
                reportProblem({ id: `scenario:${doc.id}:prediction-preparation`, level: "error", scope: `Scenario · ${doc.id}`, title: "Could not prepare prediction", message: error instanceof Error ? error.message : String(error) });
              }
            }}
          />
        </ScenarioGroup>
      ) : null}
    </div>
  );
}
