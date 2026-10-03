"use client";

import { useLayoutEffect, useRef } from "react";
import { useStore } from "@/core";
import { hostView, hosts, nameOf, offWord } from "@/workbench/hosts";
import { page } from "@/workbench/navigation";
import { useNow } from "@/workbench/clock";
import { Chip } from "./host-bar/chip";

export function HostBar() {
  const now = useNow();
  const list = useStore(hosts, (state) => state.list);
  const selected = useStore(page, (state) => state.route.workspace === "resource" && state.route.kind === "host" ? state.route.id : null);
  const strip = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    strip.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected, list.length]);
  return (
    <div
      ref={strip}
      role="toolbar"
      aria-label="Radio hosts"
      tabIndex={0}
      className="-my-1.5 flex min-w-0 flex-auto items-center gap-2 overflow-x-auto overscroll-x-contain py-1.5"
    >
      {list.length === 0 ? <span className="whitespace-nowrap text-ink2">No radio hosts</span> : list.map((host) => {
        const text = hostView(host, now).chip;
        return <Chip key={host.key} host={host} name={nameOf(host)} text={text} refused={text.cls === "off" && offWord(host).kind === "refused"} selected={selected === host.key} />;
      })}
    </div>
  );
}
