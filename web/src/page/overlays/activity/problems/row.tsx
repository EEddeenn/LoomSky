"use client";

import { useEffect, useRef } from "react";
import { dismissProblem, type ProblemRecord } from "@/workbench/feedback";
import { ProblemActions } from "@/page/shared/feedback";
import { Button, FeedbackIcon, Fig } from "@/page/shared/ui";

export function ProblemRow({ problem, selected, focusVersion }: { problem: ProblemRecord; selected: boolean; focusVersion: number }) {
  const row = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (selected) {
      row.current?.scrollIntoView({ block: "nearest" });
      row.current?.focus({ preventScroll: true });
    }
  }, [selected, focusVersion]);
  return (
    <li ref={row} tabIndex={-1} className={`flex flex-col gap-2 border-t border-line px-4 py-3 outline-none ${selected ? "bg-hover shadow-[inset_3px_0_0_var(--ink)]" : ""}`}>
      <div className="flex items-start gap-2">
        <FeedbackIcon level={problem.level} />
        <div className="min-w-0 flex-1">
          <div className="text-small font-semibold [overflow-wrap:anywhere]"><span className="vh">{problem.level}: </span>{problem.title}</div>
          {problem.location === undefined ? null : <code className="mt-1 block text-small text-ink3 [overflow-wrap:anywhere]">{problem.location}</code>}
        </div>
        {problem.urgent ? <span className="text-small font-medium text-fault">Needs action</span> : null}
      </div>
      <p className="m-0 pl-6 text-small leading-5 text-ink2 [overflow-wrap:anywhere]"><Fig>{problem.message}</Fig></p>
      <div className="flex flex-wrap items-center gap-2 pl-6">
        <ProblemActions problem={problem} />
        {problem.owner === null && !problem.urgent ? <Button size="sm" variant="ghost" onClick={() => dismissProblem(problem.id)}>Dismiss</Button> : null}
      </div>
    </li>
  );
}
