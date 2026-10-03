"use client";

import { useRef } from "react";
import { useViewport } from "@/page/shared/navigation";
import type { Plan } from "@/model/trajectory";
import { openProblems } from "@/workbench/feedback";
import { setView } from "@/workbench/navigation";
import { PlanInspector, type PlanInspectorProps } from "./inspector/plan";

export function TrajectoryInspector({ plan, ...props }: Omit<PlanInspectorProps, "plan"> & { plan: Plan | null }) {
  const body = useRef<HTMLDivElement>(null);
  useViewport(body, "trajectory:properties");
  return (
    <aside
      id="trajectory-inspector"
      aria-label="Trajectory properties"
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel"
    >
      <div ref={body} className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto overscroll-contain p-3">
        {plan === null ? (
          <div className="flex flex-col gap-2">
            <h3 className="m-0 font-semibold">Trajectory plan</h3>
            <p className="m-0 text-small text-ink3">Fix the plan structure to edit objects and rules.</p>
            <button type="button" className="self-start text-small text-fault underline underline-offset-3" onClick={() => { setView("json"); openProblems(); }}>Open JSON and Problems</button>
          </div>
        ) : (
          <PlanInspector {...props} plan={plan} />
        )}
      </div>
    </aside>
  );
}
