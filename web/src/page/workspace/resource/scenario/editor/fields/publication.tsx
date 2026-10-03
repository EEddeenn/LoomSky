"use client";

import type { ReactNode } from "react";
import { packedLeap } from "@/model/bundle";
import { gpsOfTime } from "@/model/gnss";
import { collectionItemPath } from "@/model/scenario";
import { listOf, recordOf } from "@/core";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import type { Path } from "@/model/schema";
import { Button } from "@/page/shared/ui";
import { Messages } from "@/page/shared/documents/editor";
import { diagnosticsAt, pathKey } from "@/model/document";
import { addPublication, duplicatePublication, publicationPaths, removePublication } from "@/workbench/documents/scenario/editing";
import { useCollectionSelection } from "@/workbench/documents/scenario/editing";
import { canInspectScenarioTime, inspectScenarioTime } from "@/workbench/documents/scenario/actions";
import { runDocumentEdit } from "@/workbench/documents/editing";
import { CollectionEditor } from "../collection";
import { IntervalFields } from "./time";

function timeSummary(value: unknown): string {
  const t = recordOf(value);
  if (t === undefined) return "Time missing";
  if (t.type === "UTC") return `${t.year ?? "?"}-${t.month ?? "?"}-${t.day ?? "?"} ${t.hour ?? "?"}:${t.minute ?? "?"}:${t.second ?? "?"} UTC`;
  return `${t.type ?? "?"} ${t.week === undefined ? `N4 ${t.leapYear ?? "?"}, day ${t.day ?? "?"}` : `week ${t.week}`} + ${t.second ?? "?"} s`;
}

export function PublicationList({ doc, family, label, children }: {
  doc: ScenarioDoc;
  family: "gps" | "inav" | "d2";
  label: string;
  children(path: Path): ReactNode;
}) {
  const path = publicationPaths[family];
  const value = doc.editor.value(path);
  const rows = listOf(value);
  const [selected, select] = useCollectionSelection(doc, path, rows.length);
  const selectedPath = collectionItemPath(path, value, selected);
  const window = doc.view?.lastSuccessful?.window;
  const from = recordOf(recordOf(rows[selected])?.from);
  const start = from === undefined || window === undefined ? null : gpsOfTime(from, packedLeap(window));
  const offset = start === null || window === undefined ? null : start - window.startGpsMs;
  const inspectable = canInspectScenarioTime(doc, offset);
  return (
    <section className="flex min-w-0 flex-col gap-3" data-path={pathKey(doc.kind, path)}>
      <h3 className="m-0 font-semibold">{label}</h3>
      <CollectionEditor
        label="Publications"
        items={rows.map((row, index) => {
          const item = recordOf(row) ?? {};
          const diagnostics = diagnosticsAt(doc.editor, collectionItemPath(path, value, index));
          return {
            label: `Publication ${index + 1}`,
            detail: `${timeSummary(item.from)} → ${timeSummary(item.until)}`,
            summary: Object.keys(item).filter((key) => key !== "from" && key !== "until").join(", ") || "No payloads",
            problem: diagnostics.some((diagnostic) => diagnostic.error) ? "error" : diagnostics.length > 0 ? "warning" : null,
          };
        })}
        selected={selected}
        onSelect={select}
        empty="No publications."
        actions={<Button size="xs" icon="plus" onClick={() => runDocumentEdit({ kind: "scenario", id: doc.id }, () => addPublication(doc, family))}>Add publication</Button>}
        detailPath={pathKey(doc.kind, selectedPath)}
        detailTitle={`Publication ${selected + 1}`}
        detailActions={<>
          <Button size="xs" disabled={!inspectable} title={inspectable ? "Preview interval start" : "A checked scenario is required"} onClick={() => inspectScenarioTime(doc, offset)}>Inspect start</Button>
          <Button size="xs" onClick={() => runDocumentEdit({ kind: "scenario", id: doc.id }, () => duplicatePublication(doc, family, selected))}>Duplicate</Button>
          <Button variant="ghost" size="xs" icon="x" onClick={() => runDocumentEdit({ kind: "scenario", id: doc.id }, () => removePublication(doc, family, selected))}>Remove</Button>
        </>}
      >
        <IntervalFields doc={doc} path={selectedPath} />
        {children(selectedPath)}
      </CollectionEditor>
      <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, path, "self")} />
    </section>
  );
}
