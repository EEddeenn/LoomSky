import type { ReactNode } from "react";
import { listOf } from "@/core";
import type { ScenarioDoc } from "@/workbench/documents/scenario";

export function signalList(doc: ScenarioDoc): string[] {
  return listOf(doc.editor.value(["signals"])).filter((s) => typeof s === "string");
}

export function Readout({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-0 border-l-2 border-ink py-1 pl-3 text-small leading-5 text-ink2">{children}</div>;
}
