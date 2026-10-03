"use client";

import { useRef } from "react";
import { useStore } from "@/core";
import { feedback } from "@/workbench/feedback";
import { page, setActivity } from "@/workbench/navigation";
import { Button, Softkeys, useFocusScope } from "@/page/shared/ui";
import { Events } from "./activity/events";
import { Operations } from "./activity/outputs";
import { Problems } from "./activity/problems";

export function ActivityPanel() {
  const { open, tab } = useStore(page, (s) => s.activity);
  const problems = useStore(feedback, (s) => s.problems);
  const panel = useRef<HTMLElement>(null);
  useFocusScope(panel, {
    kind: "panel", active: open, enabled: () => page.get().activity.open,
    initialFocus: () => panel.current?.querySelector<HTMLButtonElement>('[aria-label="Close Activity"]') ?? null,
    onEscape: () => setActivity({ open: false }),
  });
  return (
    <aside ref={panel} tabIndex={-1} aria-label="Activity" className={`absolute top-12 right-0 bottom-0 z-55 w-[min(440px,100%)] flex-col border-l border-line2 bg-panel shadow-float ${open ? "flex" : "hidden"}`}>
      <div className="flex min-h-12 items-center gap-2 border-b border-line py-2 pr-3 pl-4">
        <Softkeys label="Activity" options={[["problems", `Problems ${problems.length}`], ["events", "Events"]]} value={tab} onChange={(tab) => setActivity({ tab })} />
        <span className="flex-1" />
        <Button variant="ghost" size="sm" iconOnly icon="x" aria-label="Close Activity" onClick={() => setActivity({ open: false })} />
      </div>
      <Operations />
      <div className={`min-h-0 flex-1 flex-col ${tab === "problems" ? "flex" : "hidden"}`}><Problems /></div>
      <div className={`min-h-0 flex-1 flex-col ${tab === "events" ? "flex" : "hidden"}`}><Events /></div>
    </aside>
  );
}
