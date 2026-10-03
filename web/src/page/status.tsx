"use client";

import { classCounts, hosts, type HostClass } from "@/workbench/hosts";
import { useStore } from "@/core";
import { useNow } from "@/workbench/clock";
import { favicons } from "./status/favicon";

export function TabSignal() {
  const now = useNow();
  useStore(hosts, (s) => s.list);
  const c = classCounts(now);
  const words = [
    c.onair > 0 ? `${c.onair} on air` : "",
    c.armed > 0 ? `${c.armed} armed` : "",
    c.unknown > 0 ? `${c.unknown} unknown` : "",
    c.alarm > 0 ? `${c.alarm} alarm${c.alarm > 1 ? "s" : ""}` : "",
  ].filter(Boolean);
  const kind: HostClass = c.unknown > 0 ? "unknown" : c.alarm > 0 ? "alarm" : c.onair > 0 ? "onair" : c.armed > 0 ? "armed" : "off";
  return (
    <>
      <title>{words.length > 0 ? `${words.join(" · ")} · LoomSky` : "LoomSky"}</title>
      <link rel="icon" href={favicons[kind]} />
    </>
  );
}
