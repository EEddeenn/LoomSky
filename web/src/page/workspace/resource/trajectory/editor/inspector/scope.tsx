import type { Plan, PlanScope } from "@/model/trajectory";
import { NumberField } from "@/page/shared/documents/editor";
import type { TrajectoryDoc } from "@/workbench/documents/trajectory";
import { InspectorDisclosure, InspectorSelect, SideSelect, type InspectorPath } from "./fields";

function scopeKind(scope: PlanScope): string {
  if ("event" in scope) return "event";
  if ("section" in scope) return "section";
  if ("between" in scope) return "between";
  if ("time" in scope) return "time";
  if ("timeRange" in scope) return "timeRange";
  return "all";
}

export function ScopeFields({ doc, plan, path, scope, onChange }: {
  doc: TrajectoryDoc;
  plan: Plan;
  path: InspectorPath;
  scope: PlanScope;
  onChange(scope: PlanScope): void;
}) {
  const events = plan.events.map((event) => ({ value: event.id, label: event.id }));
  const sections = plan.sections.map((section) => ({ value: section.id, label: section.id }));
  return (
    <>
      <InspectorSelect
        doc={doc}
        path={path}
        label="Scope"
        value={scopeKind(scope)}
        options={[
          { value: "all", label: "Entire trajectory" },
          ...(events.length === 0 ? [] : [{ value: "event", label: "At event" }, { value: "between", label: "Between events" }]),
          ...(sections.length === 0 ? [] : [{ value: "section", label: "In section" }]),
          { value: "time", label: "At time" },
          { value: "timeRange", label: "Time range" },
        ]}
        onChange={(kind) => {
          const first = plan.events[0]?.id;
          const last = plan.events.at(-1)?.id;
          const section = plan.sections[0]?.id;
          if (kind === "event" && first !== undefined) onChange({ event: first });
          else if (kind === "section" && section !== undefined) onChange({ section });
          else if (kind === "between" && first !== undefined && last !== undefined) onChange({ between: [first, last] });
          else if (kind === "time") onChange({ time: 0 });
          else if (kind === "timeRange") onChange({ timeRange: [0, doc.view?.currentTrack?.inspection?.duration ?? 0] });
          else if (kind === "all") onChange({ all: true });
        }}
      />
      {"event" in scope ? (
        <>
          <InspectorSelect doc={doc} path={[...path, "event"]} label="Event" options={events} />
          <InspectorDisclosure title="Event side">
            <SideSelect doc={doc} path={[...path, "side"]} label="Evaluate at" defaultLabel="Default (outgoing)" />
          </InspectorDisclosure>
        </>
      ) : "section" in scope ? (
        <InspectorSelect doc={doc} path={[...path, "section"]} label="Section" options={sections} />
      ) : "between" in scope ? (
        <div className="grid grid-cols-2 gap-3">
          <InspectorSelect doc={doc} path={[...path, "between", 0]} label="From event" options={events} />
          <InspectorSelect doc={doc} path={[...path, "between", 1]} label="To event" options={events} />
        </div>
      ) : "time" in scope ? (
        <NumberField doc={doc.editor} path={[...path, "time"]} label="Time" unit="s" />
      ) : "timeRange" in scope ? (
        <div className="grid grid-cols-2 gap-3">
          <NumberField doc={doc.editor} path={[...path, "timeRange", 0]} label="From time" unit="s" />
          <NumberField doc={doc.editor} path={[...path, "timeRange", 1]} label="To time" unit="s" />
        </div>
      ) : null}
    </>
  );
}
