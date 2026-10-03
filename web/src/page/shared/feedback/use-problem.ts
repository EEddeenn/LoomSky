"use client";

import { useEffect } from "react";
import { replaceProblems, type Problem } from "@/workbench/feedback";

export function useProblem(owner: string, problem: Problem | null): void {
  useEffect(() => { replaceProblems(owner, problem === null ? [] : [problem]); }, [owner, problem]);
  useEffect(() => () => replaceProblems(owner, []), [owner]);
}
