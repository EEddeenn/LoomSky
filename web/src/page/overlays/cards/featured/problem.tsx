"use client";

import { openProblems, type ProblemRecord } from "@/workbench/feedback";
import { ProblemActions } from "@/page/shared/feedback";
import { Button, FeedbackIcon, Fig } from "@/page/shared/ui";

export function ProblemCard({ problems }: { problems: readonly ProblemRecord[] }) {
  const first = problems[0];
  if (first === undefined) return null;
  return <div role="alert" className="flex flex-col gap-2">
    <div className="flex items-start gap-2">
      <FeedbackIcon level={first.level} />
      <div className="min-w-0 flex-1">
        <div className="text-small font-semibold [overflow-wrap:anywhere]">{first.scope}</div>
        <div className="mt-0.5 text-small text-ink2">{problems.length > 1 ? `${problems.length} urgent problems` : first.title}</div>
      </div>
    </div>
    <p className="m-0 line-clamp-3 pl-6 text-small leading-5 text-ink2 [overflow-wrap:anywhere]"><Fig>{first.message}</Fig></p>
    <div className="flex flex-wrap gap-2 pl-6">
      <Button size="sm" onClick={() => openProblems(first.id)}>View {problems.length > 1 ? "problems" : "problem"}</Button>
      <ProblemActions problem={first} />
    </div>
  </div>;
}
