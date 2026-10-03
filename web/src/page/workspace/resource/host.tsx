"use client";

import { hostView, type Host } from "@/workbench/hosts";
import { useNow } from "@/workbench/clock";
import type { HostTab, ResourceRoute } from "@/workbench/navigation";
import { NavLink } from "@/page/shared/navigation";
import { hostSummary } from "@/page/shared/resources/summary";
import { Fig } from "@/page/shared/ui";
import { ResourceHeader } from "./header";
import { HostRun } from "./host/detail/run";
import { HostPreview } from "./host/detail/preview";
import { RunHistory } from "./host/detail/history";
import { DeviceTab } from "./host/detail/device";

const tabs: readonly (readonly [HostTab, string])[] = [
  ["run", "Run"],
  ["preview", "Preview"],
  ["history", "History"],
  ["device", "Device"],
];

export function HostResource({ host, route }: { host: Host; route: ResourceRoute }) {
  const now = useNow();
  const view = hostView(host, now);
  const entry = hostSummary(host, now);
  const tab = route.kind === "host" ? route.tab ?? "run" : "run";
  const status = view.chip;
  const tone = status.cls === "onair" ? "text-rf-ink" : status.cls === "alarm" ? "text-fault" : status.cls === "off" ? "text-ink2" : "text-warn-ink";
  const tools = <nav aria-label="Transmitter pages" className="flex min-w-0 flex-wrap gap-1">
    {tabs.map(([id, title]) => <NavLink
      key={id}
      aria-current={id === tab ? "page" : undefined}
      className={`inline-flex min-h-8 flex-none items-center justify-center rounded-key px-3 font-medium ${id === tab ? "bg-sel text-on-sel" : "text-ink2 hover:bg-hover hover:text-ink"}`}
      destination={{ workspace: "resource", kind: "host", id: host.key, tab: id }}
    >{title}</NavLink>)}
  </nav>;
  const badge = <span className={`inline-flex items-center gap-2 ${tone}`}>
    <span className={`size-2 flex-none rounded-full ${status.cls === "onair" ? "bg-rf" : status.cls === "alarm" ? "bg-fault" : status.cls === "off" ? "bg-ink4" : "bg-warn"}`} />
    <span className="font-medium">{status.word}</span>
    {status.figure === "" ? null : <span className="text-small"><Fig>{`${status.lead}${status.figure}${status.tail}`}</Fig></span>}
  </span>;
  return <section aria-label={`${entry.type} ${entry.name}`} className="flex min-h-0 min-w-0 flex-1 flex-col">
    <ResourceHeader entry={entry} route={route} status={badge} tools={tools} available />
    {tab === "run" ? <HostRun host={host} now={now} view={view} />
      : tab === "device" ? <DeviceTab key={host.key} host={host} now={now} view={view} />
      : tab === "history" ? <RunHistory key={host.key} host={host} now={now} view={view} />
      : <HostPreview host={host} />}
  </section>;
}
