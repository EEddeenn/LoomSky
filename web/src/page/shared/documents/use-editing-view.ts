"use client";

import { useEffect } from "react";
import { useStore } from "@/core";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import type { TrajectoryDoc } from "@/workbench/documents/trajectory";
import { page } from "@/workbench/navigation";

export function useEditingView(doc: ScenarioDoc | TrajectoryDoc, view: "form" | "json"): void {
  const visitId = useStore(page, (state) => state.visitId);
  useEffect(() => () => doc.editing.leaveView(), [doc, view, visitId]);
}
