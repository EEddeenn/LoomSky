"use client";

import { useStore } from "@/core";
import { hosts, nameOf, stopTargets } from "@/workbench/hosts";
import { stopAll } from "@/workbench/hosts/actions";
import { useNow } from "@/workbench/clock";
import { Fig, Icon } from "@/page/shared/ui";

export function StopAllButton() {
  const now = useNow();
  useStore(hosts, (state) => state.list);
  const targets = stopTargets(now);
  const n = targets.length;
  const only = n === 1 ? targets[0] : undefined;
  const hostName = only === undefined ? null : nameOf(only);
  const text = hostName !== null ? `Stop ${hostName}` : n === 0 ? "Stop all" : `Stop all (${n})`;
  return (
    <button
      type="button"
      disabled={n === 0}
      onClick={stopAll}
      title={text}
      aria-label={n === 0 ? "Stop all" : `${text}: ${targets.map(nameOf).join(", ")}`}
      aria-description={n === 0 ? "no host may be on air" : undefined}
      className={`inline-flex h-9 max-w-56 flex-none items-center gap-2 rounded-key px-3 font-semibold whitespace-nowrap ${n === 0 ? "bg-transparent text-ink3 shadow-[inset_0_0_0_1px_var(--line)]" : "bg-face text-ink shadow-[inset_0_0_0_2px_var(--ink)] hover:bg-hover"}`}
    >
      <span className={`flex-none ${n === 0 ? "text-ink4" : "text-rf-mark"}`}>
        <Icon name="stop" size={12} />
      </span>
      {hostName === null ? <Fig>{text}</Fig> : (
        <span className="flex min-w-0 items-center gap-1">
          <span className="shrink-0">Stop</span>{" "}
          <span className="truncate"><Fig>{hostName}</Fig></span>
        </span>
      )}
    </button>
  );
}
