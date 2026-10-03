"use client";

import { useStore } from "@/core";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import { useDocumentView } from "@/workbench/documents/use-document";
import { openProblems } from "@/workbench/feedback";
import type { ResourceRoute } from "@/workbench/navigation";
import { schemas } from "@/workbench/schemas";
import type { ResourceSummary } from "@/page/shared/resources/summary";
import { Button, Spinner } from "@/page/shared/ui";
import { DocumentResource } from "./document";
import { Editor } from "./scenario/editor";
import { ScenarioStatus, ScenarioTools } from "./scenario/header";

export function ScenarioResource({ doc, entry, route }: { doc: ScenarioDoc; entry: ResourceSummary; route: ResourceRoute }) {
  useDocumentView(doc);
  const schema = useStore(schemas, (state) => state.status);
  return <DocumentResource doc={doc} entry={entry} route={route} status={<ScenarioStatus doc={doc} />} tools={<ScenarioTools doc={doc} />}>
    {schema === "ready" ? <Editor doc={doc} /> : <div className="flex flex-col items-start gap-3 p-5">
      {schema === "loading"
        ? <p role="status" className="m-0 flex items-center gap-2 text-ink2"><Spinner />Loading editor…</p>
        : <Button size="sm" variant="ghost" onClick={() => openProblems()}>View problem</Button>}
    </div>}
  </DocumentResource>;
}
