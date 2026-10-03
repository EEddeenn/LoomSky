"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { trimmed } from "@/core";
import type { Plan, PlanRule, PlanScope } from "@/model/trajectory";
import { Button, Icon } from "@/page/shared/ui";
import { useViewport } from "@/page/shared/navigation";
import type { TrajectoryDoc } from "@/workbench/documents/trajectory";
import type { EditOutcome, Selection, TrajectorySession } from "@/workbench/documents/trajectory/editing";
import { freshPlanId } from "@/model/trajectory";
import { ruleSummary, scopeSummary } from "./summary";

type ObjectSelection = Exclude<Selection, null>;
type GroupKey = "points" | "curves" | "regions" | "events" | "sections" | "rules";
type OutlineItem = { selection: ObjectSelection; detail: string; hint?: string; tone?: PlanRule["kind"] };
type OutlineGroup = { key: GroupKey; label: string; empty: string; items: OutlineItem[]; addLabel: string; add(): void; canAdd: boolean };

function scopeFor(selection: Selection): PlanScope {
  if (selection?.kind === "event") return { event: selection.id };
  if (selection?.kind === "section") return { section: selection.id };
  return { all: true };
}

export function TrajectoryOutline({ doc, plan, selected, onSelect, session, onOutcome }: {
  doc: TrajectoryDoc;
  plan: Plan;
  selected: Selection;
  onSelect(selection: Selection): void;
  session: TrajectorySession;
  onOutcome(outcome: EditOutcome): void;
}) {
  const body = useRef<HTMLDivElement>(null);
  useViewport(body, "trajectory:objects");
  const editable = doc.editor.writable();
  const selectedGroup = selected === null ? null : `${selected.kind}s`;
  useEffect(() => {
    const group = body.current?.querySelector<HTMLDetailsElement>(`details[data-group="${selectedGroup}"]`);
    if (group !== null && group !== undefined) group.open = true;
  }, [selectedGroup, selected?.id]);
  const selectAdded = (outcome: EditOutcome, selection: ObjectSelection) => {
    onOutcome(outcome);
    if (outcome.ok) {
      onSelect(selection);
    }
  };
  const missingSection = plan.events.flatMap((event, index) => {
    const next = plan.events[index + 1];
    return next === undefined || plan.sections.some((section) => section.from === event.id && section.to === next.id)
      ? [] : [{ from: event.id, to: next.id }];
  })[0];
  const addSection = () => {
    if (missingSection === undefined) return;
    const id = freshPlanId(plan, "section");
    selectAdded(session.execute({ type: "add-section", section: { id, ...missingSection } }), { kind: "section", id });
  };
  const groups: OutlineGroup[] = [
    {
      key: "points", label: "Points", empty: "Choose Add point, then click the map.", addLabel: "Add point on map", canAdd: editable,
      add: () => session.setTool("point"),
      items: plan.geometry.points.map((point) => ({ selection: { kind: "point", id: point.id }, detail: `${point.position.latitude.toFixed(5)}, ${point.position.longitude.toFixed(5)}`, hint: `${trimmed(point.position.altitude)} m` })),
    },
    {
      key: "curves", label: "Curves", empty: "Draw a curve, then add a follow-curve rule.", addLabel: "Add guide curve on map", canAdd: editable,
      add: () => session.setTool("curve"),
      items: (plan.geometry.curves ?? []).map((curve) => {
        const guides = plan.rules.filter((rule) => "relation" in rule && rule.relation.type === "followCurve" && rule.relation.curve === curve.id).length;
        return { selection: { kind: "curve", id: curve.id }, detail: `${curve.type === "bezier" ? "Bézier" : "Polyline"} · ${curve.points.length} points`, ...(guides === 0 ? {} : { hint: `${guides} follow-curve ${guides === 1 ? "rule" : "rules"}` }) };
      }),
    },
    {
      key: "regions", label: "Regions", empty: "Draw a region to bound the trajectory.", addLabel: "Add region on map", canAdd: editable,
      add: () => session.setTool("region"),
      items: (plan.geometry.regions ?? []).map((region) => ({ selection: { kind: "region", id: region.id }, detail: region.type === "circle" ? `Circle · radius ${trimmed(region.radius)} m` : `Polygon · ${region.points.length} vertices`, ...(region.type === "circle" ? { hint: `Center: ${region.center}` } : {}) })),
    },
    {
      key: "events", label: "Events", empty: "Add an event to mark a trajectory state.", addLabel: "Add event", canAdd: editable, add: () => onOutcome(session.addEvent()),
      items: plan.events.map((event, index) => {
        const rules = plan.rules.filter((rule) => "event" in rule.scope && rule.scope.event === event.id).length;
        return { selection: { kind: "event", id: event.id }, detail: `${index + 1} · ${event.continuity ?? "C2"} continuity · ${rules} ${rules === 1 ? "rule" : "rules"}` };
      }),
    },
    {
      key: "sections", label: "Sections", empty: "Add consecutive events to connect with sections.",
      addLabel: missingSection === undefined ? "All consecutive events are connected" : `Connect ${missingSection.from} to ${missingSection.to}`,
      canAdd: editable && missingSection !== undefined, add: addSection,
      items: plan.sections.map((section) => ({ selection: { kind: "section", id: section.id }, detail: `${section.from} → ${section.to}` })),
    },
    {
      key: "rules", label: "Rules", empty: "Add a rule, then set its quantity, scope, and value.",
      addLabel: `Add rule · ${scopeSummary(scopeFor(selected))}`, canAdd: editable, add: () => onOutcome(session.addRule()),
      items: plan.rules.map((rule) => ({ selection: { kind: "rule", id: rule.id }, detail: ruleSummary(rule), hint: scopeSummary(rule.scope), tone: rule.kind })),
    },
  ];
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || !(event.target instanceof HTMLButtonElement) || event.target.dataset.object === undefined) return;
    const buttons = Array.from(body.current?.querySelectorAll<HTMLButtonElement>("button[data-object]") ?? []).filter((button) => button.closest("details")?.open);
    const index = buttons.indexOf(event.target);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
    const button = buttons[next];
    if (button === undefined) return;
    event.preventDefault();
    button.focus();
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Trajectory objects">
      <div ref={body} className="min-h-0 flex-1 overflow-y-auto py-1" onKeyDown={moveFocus}>
        {groups.map((group) => (
          <details key={group.key} data-group={group.key} open={group.key === "points" || group.key === "events" || group.key === "rules"} className="group">
            <summary className="flex h-8 cursor-pointer list-none items-center gap-1 pr-1 text-small font-medium text-ink2 hover:text-ink [&::-webkit-details-marker]:hidden">
              <span className="ml-2 -rotate-90 group-open:rotate-0"><Icon name="chev" size={12} /></span>
              <span className="min-w-0 flex-1 truncate">{group.label}</span>
              <span className="fn text-micro text-ink3">{group.items.length}</span>
              <Button size="xs" variant="ghost" icon="plus" iconOnly aria-label={group.addLabel} title={group.addLabel} disabled={!group.canAdd} onClick={(event) => { event.preventDefault(); group.add(); }} />
            </summary>
            {group.items.length === 0 ? <p className="px-6 pb-2 text-micro leading-4 text-ink3">{group.empty}</p> : (
              <ul className="space-y-px px-1 pb-1">
                {group.items.map((item) => {
                  const active = selected?.kind === item.selection.kind && selected.id === item.selection.id;
                  return (
                    <li key={item.selection.id}>
                      <button
                        type="button"
                        data-object={`${item.selection.kind}:${item.selection.id}`}
                        aria-pressed={active}
                        title={[item.selection.id, item.detail, item.hint].filter(Boolean).join("\n")}
                        onClick={() => onSelect(item.selection)}
                        className={`block w-full rounded-key px-2 py-1.5 text-left ${active ? "bg-sel text-on-sel" : "text-ink2 hover:bg-hover hover:text-ink"}`}
                      >
                        <span className="flex items-center gap-1.5">
                          {item.tone === undefined ? null : <span aria-hidden="true" className={`h-1.5 w-1.5 flex-none ${item.tone === "hard" ? "bg-current" : item.tone === "target" ? "rounded-full border border-current" : "rotate-45 border border-current"}`} />}
                          <span className="block min-w-0 truncate text-small font-medium">{item.selection.id}</span>
                        </span>
                        <span className={`mt-0.5 block truncate text-micro ${active ? "opacity-80" : "text-ink3"}`}>{item.detail}</span>
                        {item.hint === undefined ? null : <span className={`block truncate text-micro ${active ? "opacity-70" : "text-ink3"}`}>{item.hint}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </details>
        ))}
      </div>
    </div>
  );
}
