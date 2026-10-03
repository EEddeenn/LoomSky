"use client";

import { useStore } from "@/core";
import { resourceKey, type ResourceRef } from "@/model/resource";
import { useNow } from "@/workbench/clock";
import { scenarioCatalog } from "@/workbench/documents/scenario";
import { trajectoryCatalog } from "@/workbench/documents/trajectory";
import { hosts } from "@/workbench/hosts";
import { scenarioPreview, trajectoryPreview, useHostPreview } from "@/workbench/library/preview";
import { useSavedPreview } from "@/workbench/library/preview/common";
import { Icon, Spinner } from "@/page/shared/ui";
import { FilePreview } from "./file";
import { PreviewUnavailable } from "./info";
import { ResourceDetails } from "./preview/resource";

function SavedDocumentPreview({ resource }: { resource: Extract<ResourceRef, { kind: "scenario" | "trajectory" }> }) {
  const entry = useStore(resource.kind === "scenario" ? scenarioCatalog : trajectoryCatalog, (state) => state.entries.get(resource.id));
  useStore(scenarioCatalog, (state) => resource.kind === "trajectory" ? state.version : null);
  const reading = useSavedPreview(entry?.head);
  if (entry === undefined) return <PreviewUnavailable />;
  if (reading === null) return <div role="status" className="flex items-center gap-2 p-4 text-small text-ink3"><Spinner />Loading preview…</div>;
  if (reading.status === "error") return <p role="alert" className="m-0 p-4 text-small text-fault">{reading.message}</p>;
  const { version } = reading.value;
  const preview = version.kind === "scenario" ? scenarioPreview(version, reading.value, entry) : trajectoryPreview(version, reading.value, entry);
  return <ResourceDetails resourceKey={`${resource.kind}:${version.id}`} preview={preview} />;
}

function HostPreview({ hostKey }: { hostKey: string }) {
  useStore(hosts, (state) => state.list);
  const preview = useHostPreview(hostKey, useNow());
  return <ResourceDetails resourceKey={`host:${hostKey}`} preview={preview} />;
}

export function LibraryPreview({ resource }: { resource: ResourceRef | null }) {
  return <div key={resourceKey(resource)} aria-label="Resource preview" className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain bg-face">
    {resource === null ? <div className="flex flex-col items-start gap-3 p-5 text-ink3"><Icon name="file" size={24} /><p className="m-0 text-small">Select a resource.</p></div>
      : resource.kind === "host" ? <HostPreview hostKey={resource.key} />
      : resource.kind === "file" ? <FilePreview id={resource.id} />
      : <SavedDocumentPreview resource={resource} />}
  </div>;
}
