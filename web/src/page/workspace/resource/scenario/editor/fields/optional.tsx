"use client";

import type { ReactNode } from "react";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import { changeDocument, replaceDraftsAt, runDocumentEdit } from "@/workbench/documents/editing";
import type { Path } from "@/model/schema";
import { Button, Toggle } from "@/page/shared/ui";
import { pathKey } from "@/model/document";

export function OptionalBlock({ doc, path, label, title, create, children, toggle = false }: { doc: ScenarioDoc; path: Path; label: string; title?: string; create(): unknown; children: ReactNode; toggle?: boolean }) {
  const exists = doc.editor.value(path) !== undefined;
  const change = () => toggle
    ? changeDocument(doc, () => doc.editor.write(path, exists ? undefined : create()))
    : runDocumentEdit({ kind: "scenario", id: doc.id }, () => replaceDraftsAt(doc.editor, path, exists ? undefined : create()));
  return (
    <section className={`flex min-w-0 flex-col gap-3 ${toggle ? "" : "border-t border-line pt-3"}`} data-path={pathKey(doc.kind, path)}>
      {toggle ? <Toggle checked={exists} onChange={change} title={title}>{label}</Toggle> : (
        <header className="flex items-center gap-2">
          <h4 className="lab m-0 text-ink2" title={title}>{label}</h4>
          <span className="flex-1" />
          <Button size="xs" onClick={change}>
            {exists ? "Remove" : "Add"}
          </Button>
        </header>
      )}
      {exists ? children : null}
    </section>
  );
}
