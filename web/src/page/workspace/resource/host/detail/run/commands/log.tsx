"use client";

import { commandWords } from "@/workbench/hosts";
import type { HostDisplay } from "@/page/workspace/resource/host";
import { gpsClock, utcClock } from "@/model/gnss";
import { openProblems } from "@/workbench/feedback";
import { Button, Fig, Icon } from "@/page/shared/ui";

export function CommandLog({ host, view }: HostDisplay) {
  const { snapshot, status: s, window: w, leap } = view;
  if (snapshot === null || s === null || s.commands.length === 0) return <p className="m-0 text-small text-ink3">No commands yet.</p>;
  return (
    <ul className="m-0 flex list-none flex-col border-t border-line2 p-0">
      {s.commands.map((r, i) => {
        const applied = r.applied !== null && "epoch" in r.applied ? r.applied.epoch : null;
        const rejected = r.applied !== null && "rejected" in r.applied ? r.applied.rejected : null;
        const discarded = r.applied !== null && "discarded" in r.applied ? r.applied.discarded : null;
        const terminal = rejected !== null || discarded !== null;
        return (
          <li key={i} className={`grid gap-x-2 gap-y-1 py-1 leading-5 ${i > 0 ? "border-t border-line" : ""} ${terminal ? "grid-cols-[16px_minmax(0,1fr)]" : "grid-cols-[16px_max-content_minmax(0,1fr)] items-baseline"}`}>
            <span className={`mt-[3px] ${terminal ? "text-warn-ink" : "text-ink3"}`}>
              <Icon name={applied !== null ? "done" : terminal ? "warn" : "clock"} size={14} />
            </span>
            <span className="font-medium">
              <Fig>{commandWords(r.command)}</Fig>
            </span>
            <span className={`text-small text-ink2 ${terminal ? "col-start-2" : "text-right whitespace-nowrap"}`}>
              {applied !== null && w !== null ? (
                <>
                  <span className="vh">applied at </span>
                  <span title={`${utcClock(w.startGpsMs + applied, leap, true)} UTC`}>
                    <Fig>{`${gpsClock(w.startGpsMs + applied, true)} GPS`}</Fig>
                  </span>
                </>
              ) : terminal ? (
                <Button size="xs" variant="ghost" onClick={() => openProblems(`host:${host.key}:command:${snapshot.boot}:${snapshot.run}:${i}`)}>
                  {rejected !== null ? "Rejected" : "Discarded"} · Details
                </Button>
              ) : (
                "queued"
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
