"use client";

import { useState, type ReactNode } from "react";
import { useStore } from "@/core";
import { page, type ResourceRoute } from "@/workbench/navigation";
import type { ResourceSummary } from "@/page/shared/resources/summary";
import { DocumentSyncNotice, VersionChip, type VersionDocument } from "@/page/shared/documents/versions";
import { ResourceHeader } from "./header";
import { VersionHistory } from "./version-history";

export function DocumentResource({ doc, entry, route, title, status, tools, context, children }: {
  doc: VersionDocument;
  entry: ResourceSummary;
  route: ResourceRoute;
  title?: ReactNode;
  status: ReactNode;
  tools: ReactNode;
  context?: ReactNode;
  children: ReactNode;
}) {
  const visit = useStore(page, (state) => state.visitId);
  const [historyVisit, setHistoryVisit] = useState<number | null>(null);
  const openHistory = () => setHistoryVisit(visit);
  return <>
    <ResourceHeader entry={entry} route={route} title={title} version={<VersionChip doc={doc} onClick={openHistory} />} status={status} tools={tools} available>{context}</ResourceHeader>
    <DocumentSyncNotice doc={doc} onHistory={openHistory} />
    {children}
    {historyVisit !== visit ? null : <VersionHistory doc={doc} name={entry.name} onClose={() => setHistoryVisit(null)} />}
  </>;
}
