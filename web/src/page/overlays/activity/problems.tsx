"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/core";
import { feedback, type ProblemRecord } from "@/workbench/feedback";
import { FeedbackIcon, Softkeys } from "@/page/shared/ui";
import { ProblemRow } from "./problems/row";

export function Problems() {
  const problems = useStore(feedback, (state) => state.problems);
  const selected = useStore(feedback, (state) => state.selected);
  const focusVersion = useStore(feedback, (state) => state.focusVersion);
  const [filter, setFilter] = useState<"all" | "error" | "warning">("all");
  useEffect(() => { if (selected !== null) setFilter("all"); }, [selected, focusVersion]);

  const shown = problems
    .filter((problem) => filter === "all" || problem.level === filter)
    .toSorted((a, b) => (
      Number(Boolean(b.urgent)) - Number(Boolean(a.urgent))
        || Number(b.level === "error") - Number(a.level === "error")
        || b.created - a.created
    ));
  const groups = new Map<string, ProblemRecord[]>();
  for (const problem of shown) {
    const group = groups.get(problem.scope) ?? [];
    group.push(problem);
    groups.set(problem.scope, group);
  }
  return (
    <>
      <div className="flex flex-none border-b border-line2 px-4 py-3">
        <Softkeys<"all" | "error" | "warning">
          label="Problem level" value={filter} onChange={setFilter}
          options={[
            ["all", `All ${problems.length}`],
            ["error", `Errors ${problems.filter((problem) => problem.level === "error").length}`],
            ["warning", `Warnings ${problems.filter((problem) => problem.level === "warning").length}`],
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {shown.length === 0 ? <div className="flex items-center gap-2 p-5 text-ink2"><FeedbackIcon level="success" /><span>{problems.length === 0 ? "No problems" : "No matching problems"}</span></div> : [...groups].map(([scope, items]) => (
          <section key={scope} aria-label={scope}>
            <h3 className="sticky top-0 z-1 m-0 border-y border-line2 bg-panel px-4 py-2 text-small font-semibold [overflow-wrap:anywhere]">{scope} <span className="fn ml-1 font-normal text-ink3">{items.length}</span></h3>
            <ul className="m-0 list-none p-0">{items.map((problem) => <ProblemRow key={problem.id} problem={problem} selected={problem.id === selected} focusVersion={focusVersion} />)}</ul>
          </section>
        ))}
      </div>
    </>
  );
}
