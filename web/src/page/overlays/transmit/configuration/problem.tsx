"use client";

import { openProblems } from "@/workbench/feedback";
import { useProblem } from "@/page/shared/feedback";
import { Button } from "@/page/shared/ui";

export function ProblemCue({ id, title, message, location, level = "error" }: { id: string; title: string; message: string; location: string; level?: "error" | "warning" }) {
  useProblem(id, { id, level, scope: "Transmission", title, message, location });
  return <Button variant="ghost" size="sm" className={`self-start ${level === "error" ? "text-fault" : "text-warn-ink"}`} onClick={() => openProblems(id)}><span className="sr-only">{title}. </span>Details</Button>;
}
