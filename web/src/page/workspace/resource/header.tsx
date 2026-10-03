import type { ReactNode } from "react";
import { NavLink } from "@/page/shared/navigation";
import { ResourceActions } from "@/page/shared/resources/actions";
import type { ResourceRoute } from "@/workbench/navigation";
import type { ResourceSummary } from "../../shared/resources/summary";

export function ResourceHeader({ entry, route, version, title, status, tools, available, children }: {
  entry: ResourceSummary;
  route: ResourceRoute;
  version?: ReactNode;
  title?: ReactNode;
  status: ReactNode;
  tools?: ReactNode;
  available: boolean;
  children?: ReactNode;
}) {
  return <header className="flex min-h-12 flex-none flex-wrap items-center gap-x-3 gap-y-2 border-b border-line2 bg-panel px-3 py-2">
    <NavLink size="sm" variant="ghost" icon="list" destination={{ workspace: "library" }}>Library</NavLink>
    <h1 className={title === undefined ? "m-0 min-w-0 text-title font-semibold [overflow-wrap:anywhere]" : "sr-only"}>{entry.name}</h1>
    {title}
    {route.kind === "file" || route.kind === "host" ? <span className="rounded-key bg-face px-2 py-0.5 text-small text-ink2">{entry.type}</span> : null}
    {version}
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-small">{status}</div>
    <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
      {children}
      {tools}
      {available ? <ResourceActions resource={entry.resource} name={entry.name} mode="detail" returnScenario={route.kind === "trajectory" ? route.returnScenario : undefined} /> : null}
    </div>
  </header>;
}
