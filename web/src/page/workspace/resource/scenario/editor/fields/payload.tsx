"use client";

import { useSyncExternalStore } from "react";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import { draftText, subscribeDrafts } from "@/workbench/documents/editing";
import { useStore } from "@/core";
import { schemas } from "@/workbench/schemas";
import type { Path } from "@/model/schema";
import { DraftInput, Field, Messages } from "@/page/shared/documents/editor";
import { diagnosticsAt, pathKey } from "@/model/document";

export function PayloadTextField({ doc, path, label, kind }: { doc: ScenarioDoc; path: Path; label: string; kind: "broadcast" | "hex87" }) {
  const rules = useStore(schemas, (state) => state.scenario?.properties?.messages?.["x-publication"]);
  const digits = rules?.inav.testHexDigits ?? 22;
  const limit = rules?.gps.textLength ?? 288;
  const value = doc.editor.value(path);
  const text = typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value);
  const pending = useSyncExternalStore((listener) => subscribeDrafts(doc.editor, listener), () => draftText(doc.editor, path), () => undefined);
  const shown = pending ?? text;
  return (
    <Field label={label} path={pathKey(doc.kind, path)}>
      <DraftInput
        doc={doc.editor}
        path={path}
        label={label}
        value={text}
        codec={kind === "hex87" ? { kind, digits } : { kind, limit }}
        multiline={kind === "broadcast"}
        error={kind === "hex87" ? `Enter ${digits} hex digits, starting with 0–7.` : `Use 1–${limit} broadcast characters: A–Z, 0–9, space, + − . ' / : \" °.`}
      />
      <span className="fn text-small text-ink3">{kind === "hex87" ? `${shown.length}/${digits} hex digits · 87 bits` : `${[...shown].length}/${limit} characters`}</span>
      <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, path)} />
    </Field>
  );
}
