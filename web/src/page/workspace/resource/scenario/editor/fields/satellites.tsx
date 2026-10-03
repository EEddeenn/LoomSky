"use client";

import type { ScenarioDoc } from "@/workbench/documents/scenario";
import { listOf } from "@/core";
import type { Path } from "@/model/schema";
import { DraftInput, Field, Messages, useSchema } from "@/page/shared/documents/editor";
import { diagnosticsAt, pathKey } from "@/model/document";

export function SatelliteSetField({ doc, path, label, min, max, allowEmpty = true, singleOrArray = false, bankSize, hint, allLabel, enforceAllExclusive = false }: {
  doc: ScenarioDoc;
  path: Path;
  label: string;
  min?: number;
  max?: number;
  allowEmpty?: boolean;
  singleOrArray?: boolean;
  bankSize?: number;
  hint?: string;
  allLabel?: string;
  enforceAllExclusive?: boolean;
}) {
  const meta = useSchema(doc.editor, path);
  const raw = doc.editor.value(path);
  const text = listOf(raw).map((value) => typeof value === "number" ? String(value) : JSON.stringify(value)).join(", ");
  const scalar = meta.node?.items
    ?? meta.node?.anyOf?.find((node) => node.type === "array")?.items
    ?? meta.node?.anyOf?.find((node) => node.type === "integer")
    ?? meta.node;
  const lower = min ?? scalar?.minimum ?? 1;
  const upper = max ?? scalar?.maximum;
  return (
    <Field label={label} path={pathKey(doc.kind, path)}>
      <DraftInput
        doc={doc.editor}
        path={path}
        label={label}
        value={text}
        codec={{
          kind: "satellites", lower, upper, allowEmpty, bankSize, enforceAllExclusive,
          minItems: meta.node?.minItems, maxItems: meta.node?.maxItems,
          scalar: singleOrArray && !Array.isArray(raw),
        }}
        error={`Use unique integers or ranges ${upper === undefined ? `from ${lower}` : `${lower}–${upper}`}${bankSize === undefined ? "" : " within one mask bank"}${enforceAllExclusive ? "; use 0 alone" : ""}.`}
        placeholder={allLabel}
        title={hint}
      />
      {allLabel !== undefined ? <span className="text-small text-ink3">{allLabel}</span> : null}
      <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, path)} />
    </Field>
  );
}
