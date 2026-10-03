"use client";

import { useEffect, type ReactNode } from "react";
import type { ResourceRef } from "@/model/resource";
import { openProblems, replaceProblems } from "@/workbench/feedback";

import { navigate, type ResourceRoute } from "@/workbench/navigation";
import { resourceSummary, useLibraryResource, type ResourceSummary } from "@/page/shared/resources/summary";
import { Button, Spinner } from "@/page/shared/ui";
import { FileResource } from "./resource/file";
import { ResourceHeader } from "./resource/header";
import { HostResource } from "./resource/host";
import { ScenarioResource } from "./resource/scenario";
import { TrajectoryResource } from "./resource/trajectory";

const kindNames = { scenario: "Scenario", trajectory: "Trajectory", host: "Transmitter", file: "Data file" } as const;

export function ResourceDetail({ route }: { route: ResourceRoute }) {
  const resource: ResourceRef = route.kind === "host" ? { kind: "host", key: route.id } : { kind: route.kind, id: route.id };
  const resolution = useLibraryResource(resource);
  const value = resolution.status === "ready" ? resolution.value : null;
  const loading = resolution.status === "loading";
  const missing = resolution.status === "missing";
  const problem = `resource:${route.kind}:${route.id}`;
  useEffect(() => {
    replaceProblems(problem, missing ? [{
      id: problem, level: "warning", scope: kindNames[route.kind],
      title: `${kindNames[route.kind]} unavailable`,
      message: "This resource is no longer in this browser's Library.",
      actions: [{ id: "open-library", label: "Open Library", run: () => navigate({ workspace: "library" }) }],
    }] : []);
    return () => replaceProblems(problem, []);
  }, [missing, problem, route.kind]);

  if (value?.kind === "host") return <HostResource host={value.host} route={route} />;

  const entry: ResourceSummary = value === null ? {
    resource, name: route.id, type: kindNames[route.kind],
    status: loading ? "Loading…" : "Unavailable", secondary: "",
  } : resourceSummary(value);
  let content: ReactNode;
  if (value === null) content = <>
    <ResourceHeader entry={entry} route={route} status={<span className="text-ink3">{entry.status}</span>} available={false} />
    <div className="flex flex-col items-start gap-3 p-5">
      {loading ? <p role="status" className="m-0 flex items-center gap-2 text-ink2"><Spinner />Loading…</p> : <>
        <p className="m-0 text-ink2">{missing ? "This resource is no longer in this browser's Library." : "Could not load resource."}</p>
        <Button size="sm" variant="ghost" onClick={() => openProblems(missing ? problem : undefined)}>View problem</Button>
      </>}
    </div>
  </>;
  else if (value.kind === "scenario") content = <ScenarioResource doc={value.doc} entry={entry} route={route} />;
  else if (value.kind === "trajectory") content = <TrajectoryResource doc={value.doc} entry={entry} route={route} />;
  else content = <FileResource file={value.file} entry={entry} route={route} />;

  return <section aria-label={`${entry.type} ${entry.name}`} className="flex min-h-0 min-w-0 flex-1 flex-col">{content}</section>;
}
