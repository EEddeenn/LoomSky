"use client";

import { useStore } from "@/core";
import { feedback } from "@/workbench/feedback";
import { page, setActivity } from "@/workbench/navigation";
import { Button } from "@/page/shared/ui";

export function ActivityButton() {
  const problems = useStore(feedback, (state) => state.problems);
  const open = useStore(page, (state) => state.activity.open);
  const pending = useStore(feedback, (state) => state.confirmation === null ? 0 : 1);
  const hasErrors = problems.some((problem) => problem.level === "error");
  return (
    <Button
      variant="ghost"
      icon={problems.length === 0 ? "list" : hasErrors ? "xc" : "warn"}
      aria-label={`Activity: ${problems.length} problems, ${pending} pending confirmations`}
      aria-expanded={open}
      className={`h-9 ${hasErrors ? "text-fault" : problems.length > 0 ? "text-warn-ink" : ""}`}
      onClick={() => setActivity({ open: !open })}
    >
      {problems.length === 0 ? "Activity" : problems.length}
      {pending > 0 ? <span className="fn rounded-key bg-hover px-1.5 text-small text-ink">Pending</span> : null}
    </Button>
  );
}
