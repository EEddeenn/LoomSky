"use client";

import type { ScenarioDoc } from "@/workbench/documents/scenario";
import { useStore } from "@/core";
import { scenarioProblems } from "@/model/scenario";
import { draftIssues } from "@/workbench/documents/editing";
import { schemas } from "@/workbench/schemas";
import { sectionOf, type ScenarioTab } from "@/workbench/navigation";
import { NavLink } from "@/page/shared/navigation";
import { FeedbackIcon } from "@/page/shared/ui";

export const scenarioSections: readonly (readonly [ScenarioTab, string, string])[] = [
  ["setup", "Setup", "Scenario & trajectory"],
  ["navigation", "Data", "Navigation data & models"],
  ["signals", "Signals", "Signals & power"],
  ["messages", "Messages", "Messages & services"],
  ["outputs", "Outputs", "Output files"],
];

export function ScenarioNavigation({ doc, current }: { doc: ScenarioDoc; current: ScenarioTab }) {
  const schema = useStore(schemas, (state) => state.scenario);
  const problems = scenarioProblems(doc, schema, draftIssues(doc.editor));
  return (
    <nav aria-label="Scenario configuration" className="grid flex-none grid-cols-5 gap-1 border-b border-line2 bg-panel p-2">
      {scenarioSections.map(([id, title, label]) => {
        const issues = problems.filter((issue) => sectionOf({ path: String(issue.path[0] ?? "") }) === id);
        const errors = issues.filter((issue) => issue.error).length;
        return (
          <NavLink
            key={id}
            aria-current={id === current ? "page" : undefined}
            title={label}
            destination={{ workspace: "resource", kind: "scenario", id: doc.id, tab: id, view: "form" }}
            className={`inline-flex min-h-7 min-w-0 flex-wrap items-center justify-center gap-1 rounded-key px-1 py-1 text-small font-medium ${id === current ? "bg-sel text-on-sel" : "text-ink2 hover:bg-hover hover:text-ink"}`}
          >
            <span>{title}</span>
            {issues.length > 0 ? (
              <span className={`inline-flex items-center ${id === current ? "" : errors > 0 ? "text-fault" : "text-warn-ink"}`}>
                <FeedbackIcon level={errors > 0 ? "error" : "warning"} size={12} />
                <span className="vh">{errors > 0 ? `${errors} errors` : `${issues.length} warnings`}</span>
              </span>
            ) : null}
          </NavLink>
        );
      })}
    </nav>
  );
}
