"use client";

import { useStore } from "@/core";
import { feedback, runProblemAction, type Problem } from "@/workbench/feedback";
import { Button } from "@/page/shared/ui";

export function ProblemActions({ problem }: { problem: Problem }) {
  const pending = useStore(feedback, (state) => state.pendingActions.get(problem.id)?.actionId);
  return problem.actions?.map((action) => (
    <Button
      key={action.id}
      size="sm"
      disabled={action.disabled || pending !== undefined}
      onClick={() => void runProblemAction(problem.id, action.id)}
    >
      {pending === action.id ? "Working…" : action.label}
    </Button>
  ));
}
