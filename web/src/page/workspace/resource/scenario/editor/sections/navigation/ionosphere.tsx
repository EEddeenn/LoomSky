"use client";

import { recordOf, useStore } from "@/core";
import { ionosphereAcceptsCoefficients, scenarioIssues } from "@/model/scenario";
import { words } from "@/model/schema";
import { Select } from "@/page/shared/documents/editor";
import { Field, Messages, NumberField, useSchema } from "@/page/shared/documents/editor";
import { diagnosticsAt } from "@/model/document";
import { Button, FeedbackIcon } from "@/page/shared/ui";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import { schemas } from "@/workbench/schemas";
import { openProblems } from "@/workbench/feedback";
import { changeDocument } from "@/workbench/documents/editing";

export function IonosphereFields({ doc }: { doc: ScenarioDoc }) {
  const root = useStore(schemas, (s) => s.scenario);
  const modelMeta = useSchema(doc.editor, ["ionosphere", "model"]);
  const coefficientsMeta = useSchema(doc.editor, ["ionosphere", "parameters"]);
  const block = recordOf(doc.editor.value(["ionosphere"]));
  const model = typeof block?.model === "string" ? block.model : modelMeta.defaultText;
  const parameters = doc.editor.value(["ionosphere", "parameters"]);
  const custom = parameters !== undefined;
  const coefficients = root?.["x-ionosphere-coefficients"]?.[model] ?? [];
  const count = coefficientsMeta.node?.maxItems ?? coefficients.length;
  const accepts = ionosphereAcceptsCoefficients(root, model);
  const coefficientIssue = scenarioIssues(doc, root).find((issue) => issue.kind === "ionosphere-coefficients");
  const changeModel = (next: string) =>
    changeDocument(doc, () => {
      const changes: { path: (string | number)[]; value: unknown }[] = [{ path: ["ionosphere", "model"], value: next }];
      if (custom && (!ionosphereAcceptsCoefficients(root, next) || root?.["x-ionosphere-coefficients"]?.[next]?.length !== count)) {
        changes.push({ path: ["ionosphere", "parameters"], value: undefined });
      }
      doc.editor.writeMany(changes);
    });

  return (
    <div className="flex min-w-0 flex-col gap-3" data-path="scenario:ionosphere">
      <div className="grid grid-cols-1 gap-3">
        <Field label="Model" path="scenario:ionosphere.model" status={modelMeta.source}>
          <Select aria-label="Ionosphere model" value={model} title={model === "auto" ? "After checks, resolve each constellation’s model and coefficients from navigation data." : modelMeta.description} disabled={!doc.editor.writable()} onChange={(e) => changeModel(e.target.value)}>
            {words(modelMeta.node).map((word) => <option key={word} value={word}>{word}</option>)}
          </Select>
        </Field>
        {accepts ? (
          <Field label="Coefficients" path="scenario:ionosphere.parameters" status={custom ? "Explicit" : "Auto"}>
            <Select
              aria-label="Coefficient values"
              title={custom ? "Custom coefficients also populate supported navigation messages." : "Resolve coefficients from navigation data after checks."}
              value={custom ? "custom" : "navigation"}
              disabled={!doc.editor.writable()}
              onChange={(e) => changeDocument(doc, () =>
                doc.editor.write(["ionosphere", "parameters"], e.target.value === "custom" ? Array.from({ length: count }, () => null) : undefined),
              )}
            >
              <option value="navigation">Navigation data</option>
              <option value="custom">Custom</option>
            </Select>
          </Field>
        ) : null}
      </div>
      {custom && accepts ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: Math.max(count, Array.isArray(parameters) ? parameters.length : 0) }, (_, i) => (
            <NumberField
              key={i}
              doc={doc.editor}
              path={["ionosphere", "parameters", i]}
              label={coefficients[i]?.name ?? `Coefficient ${i + 1}`}
              unit={coefficients[i]?.unit ?? coefficientsMeta.unit}
            />
          ))}
        </div>
      ) : null}
      {coefficientIssue !== undefined ? (
        <div className="flex items-center gap-2 text-small">
          {coefficientIssue.diagnostic === undefined ? <button type="button" className="inline-flex items-center gap-1 text-fault" onClick={() => openProblems(coefficientIssue.id)}><FeedbackIcon level="error" size={14} /><span className="underline underline-offset-3">Coefficient issue</span></button> : null}
          <Button size="xs" onClick={() => changeDocument(doc, () => doc.editor.write(["ionosphere", "parameters"], undefined))}>
            Remove coefficients
          </Button>
        </div>
      ) : null}
      <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, ["ionosphere"])} />
    </div>
  );
}
