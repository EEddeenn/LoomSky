"use client";

import { useState } from "react";
import { useStore } from "@/core";
import type { TrajectoryDoc } from "@/workbench/documents/trajectory";
import { documentView, page, type ResourceRoute } from "@/workbench/navigation";
import type { ResourceSummary } from "@/page/shared/resources/summary";
import { DocumentResource } from "./document";
import { TrajectoryEditor } from "./trajectory/editor";
import { NameField, TrajectoryContext, TrajectoryStatus, TrajectoryTools } from "./trajectory/header";

export function TrajectoryResource({ doc, entry, route }: { doc: TrajectoryDoc; entry: ResourceSummary; route: ResourceRoute }) {
  const view = useStore(page, (state) => documentView(state.route));
  const [busy, setBusy] = useState(false);
  const action = (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    void work().finally(() => setBusy(false));
  };
  return <DocumentResource
    doc={doc} entry={entry} route={route} title={<NameField doc={doc} />} status={<TrajectoryStatus doc={doc} />}
    tools={<TrajectoryTools doc={doc} busy={busy} action={action} view={view} />}
    context={<TrajectoryContext doc={doc} returnScenario={route.kind === "trajectory" ? route.returnScenario : undefined} busy={busy} action={action} />}
  >
    <TrajectoryEditor doc={doc} />
  </DocumentResource>;
}
