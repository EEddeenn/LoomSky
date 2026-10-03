import { useId, useState } from "react";
import { trimmed } from "@/core";
import { diagnosticsAt } from "@/model/document";
import { planFrom, type Plan, type PlanEvent, type PlanInitialState, type PlanCommand, type PlanSection } from "@/model/trajectory";
import { Field, Messages, NumberField, TextField } from "@/page/shared/documents/editor";
import { Button, TextInput } from "@/page/shared/ui";
import type { TrajectoryDoc } from "@/workbench/documents/trajectory";
import { changeDocument } from "@/workbench/documents/editing";
import type { EditOutcome, Selection, TrajectorySession } from "@/workbench/documents/trajectory/editing";
import { applyPlanCommand, referencesTo } from "@/model/trajectory";
import { ruleSummary, scopeSummary } from "../summary";
import { InspectorDisclosure, InspectorHeading, InspectorSection, InspectorSelect, PositionFields, VectorFields } from "./fields";
import { CurveInspector, PointInspector, RegionInspector } from "./geometry";
import { RuleInspector } from "./rule";

function CurrentResult({ doc, selected }: { doc: TrajectoryDoc; selected: Selection }) {
  const inspection = doc.view?.currentTrack?.inspection;
  if (inspection === null || inspection === undefined) return null;
  const values: { label: string; value: string }[] = [];
  const format = (value: number, unit = "") => Number.isFinite(value) ? `${trimmed(value)}${unit === "" ? "" : ` ${unit}`}` : "Unavailable";
  if (selected?.kind === "event") {
    const event = inspection.events.find((item) => item.id === selected.id);
    if (event !== undefined) values.push({ label: "Time", value: format(event.time, "s") }, { label: "Speed", value: format(event.speed, "m/s") }, { label: "Altitude", value: format(event.altitude, "m") });
  } else if (selected?.kind === "section") {
    const section = inspection.sections.find((item) => item.id === selected.id);
    if (section !== undefined) values.push({ label: "Start", value: format(section.start, "s") }, { label: "End", value: format(section.end, "s") }, { label: "Duration", value: format(section.end - section.start, "s") });
  } else if (selected?.kind === "rule") {
    const rule = inspection.rules.find((item) => item.id === selected.id);
    if (rule !== undefined) values.push({ label: "Violation", value: format(rule.violation) }, { label: "Residual", value: format(rule.residual) }, { label: "Active", value: rule.active ? "Yes" : "No" });
  } else if (selected === null) {
    values.push({ label: "Duration", value: format(inspection.duration, "s") }, { label: "Distance", value: format(inspection.distance, "m") }, { label: "Iterations", value: String(inspection.solve.iterations) });
  }
  if (values.length === 0) return null;
  return (
    <InspectorSection title={doc.view?.ready ? "Verified result" : "Current candidate"}>
      {doc.view?.ready ? null : <p className="m-0 text-small text-warn-ink">This candidate has not passed verification.</p>}
      <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-small">
        {values.map((item) => <div key={item.label} className="contents"><dt className="text-ink3">{item.label}</dt><dd className="fn m-0 text-right">{item.value}</dd></div>)}
      </dl>
    </InspectorSection>
  );
}

function EventInspector({ doc, plan, event, index, onAddStop, onReplaceState }: {
  doc: TrajectoryDoc;
  plan: Plan;
  event: PlanEvent;
  index: number;
  onAddStop(duration: number): void;
  onReplaceState(update: (state: PlanInitialState) => PlanInitialState): void;
}) {
  const durationId = useId();
  const [duration, setDuration] = useState("");
  const validDuration = duration.trim() !== "" && Number.isFinite(Number(duration)) && Number(duration) > 0;
  const invalidDuration = duration.trim() !== "" && !validDuration;
  const states = plan.initialGuess?.states ?? [];
  const stateIndex = states.findIndex((state) => state.event === event.id);
  const state = states[stateIndex];
  const positionRule = plan.rules.find((rule) => "quantity" in rule && rule.quantity === "position" && rule.kind === "hard" && "event" in rule.scope && rule.scope.event === event.id);
  const positionValue = positionRule !== undefined && "quantity" in positionRule && positionRule.kind === "hard" ? positionRule.eq : undefined;
  const positionPoint = positionValue !== undefined && typeof positionValue !== "number" && !Array.isArray(positionValue) && "point" in positionValue
    ? plan.geometry.points.find((point) => point.id === positionValue.point)
    : undefined;
  const fields = [
    { key: "position", label: "Position", unit: "m", value: positionPoint?.position ?? plan.geometry.points[0]?.position ?? { latitude: 0, longitude: 0, altitude: 0 } },
    { key: "velocityEcef", label: "Velocity", unit: "m/s", value: [0, 0, 0] },
    { key: "accelerationEcef", label: "Acceleration", unit: "m/s²", value: [0, 0, 0] },
    { key: "course", label: "Course", unit: "°", value: 0 },
  ] as const;
  return (
    <>
      <InspectorDisclosure title="Add a stop">
        <Field label="Stop duration" htmlFor={durationId}>
          <div className="flex items-center gap-2">
            <TextInput id={durationId} type="number" min="0" step="0.1" value={duration} aria-invalid={invalidDuration} aria-describedby={`${durationId}-help`} onChange={(change) => setDuration(change.target.value)} />
            <span className="text-small text-ink3">s</span>
            <Button size="sm" disabled={!validDuration} onClick={() => { if (validDuration) onAddStop(Number(duration)); }}>Add stop</Button>
          </div>
          <p id={`${durationId}-help`} className={`m-0 text-small ${invalidDuration ? "text-warn-ink" : "text-ink3"}`}>{invalidDuration ? "Enter a positive, finite duration." : "Adds a departure event and a section at zero speed for this duration."}</p>
        </Field>
      </InspectorDisclosure>
      <InspectorDisclosure title="Advanced" summary={event.continuity}>
        <InspectorSelect
          doc={doc}
          path={["events", index, "continuity"]}
          label="Continuity"
          value={event.continuity ?? ""}
          options={[{ value: "", label: "Default (C2)" }, { value: "C0", label: "C0 · Position" }, { value: "C1", label: "C1 · Position and velocity" }, { value: "C2", label: "C2 · Position, velocity, acceleration" }]}
          changes={(continuity) => [{ path: ["events", index, "continuity"], value: continuity === "" ? undefined : continuity }]}
        />
        <p className="m-0 text-small text-ink3">Continuity joins this event’s incoming and outgoing states.</p>
        <InspectorSection title="Initial guess">
          <NumberField doc={doc.editor} path={["initialGuess", "eventTimes", event.id]} label="Event time guess" unit="s" placeholder="Automatic" />
          <p className="m-0 text-small text-ink3">Initial guesses guide generation. Use a rule to require a value.</p>
          {fields.map((field) => state?.[field.key] === undefined ? (
            <Button key={field.key} size="xs" variant="ghost" className="self-start" onClick={() => onReplaceState((current) => ({ ...current, [field.key]: field.value }))}>Add {field.label.toLowerCase()} guess</Button>
          ) : (
            <div key={field.key} className="flex flex-col gap-2 rounded-key border border-line2 p-2">
              <div className="flex items-center gap-2">
                <h4 className="m-0 flex-1 text-small font-medium">{field.label} guess</h4>
                <Button size="xs" variant="ghost" icon="trash" iconOnly aria-label={`Remove ${field.label.toLowerCase()} guess`} onClick={() => onReplaceState((current) => {
                  const next = { ...current };
                  delete next[field.key];
                  return next;
                })} />
              </div>
              {field.key === "position" ? <PositionFields doc={doc} path={["initialGuess", "states", stateIndex, "position"]} /> : field.key === "course" ? (
                <NumberField doc={doc.editor} path={["initialGuess", "states", stateIndex, "course"]} label="Course" unit="°" />
              ) : (
                <VectorFields doc={doc} path={["initialGuess", "states", stateIndex, field.key]} unit={field.unit} />
              )}
            </div>
          ))}
        </InspectorSection>
      </InspectorDisclosure>
      <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, ["events", index], "self")} />
    </>
  );
}

function SectionInspector({ doc, plan, index, onReplace }: { doc: TrajectoryDoc; plan: Plan; index: number; onReplace(update: (section: PlanSection) => PlanSection): void }) {
  const events = plan.events.map((event) => ({ value: event.id, label: event.id }));
  return (
    <>
      <InspectorSelect doc={doc} path={["sections", index, "from"]} label="From event" options={events} onChange={(from) => onReplace((current) => ({ ...current, from }))} />
      <InspectorSelect doc={doc} path={["sections", index, "to"]} label="To event" options={events} onChange={(to) => onReplace((current) => ({ ...current, to }))} />
      <p className="m-0 text-small text-ink3">Section rules apply throughout this interval.</p>
      <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, ["sections", index], "self")} />
    </>
  );
}

function removalImpact(plan: Plan, selected: NonNullable<Selection>): { cascade: boolean; summary: string } {
  const result = applyPlanCommand(plan, { type: "remove", selection: selected, cascade: true });
  if (!result.ok) return { cascade: false, summary: "" };
  const groups = [
    { kind: "point", before: plan.geometry.points, after: result.plan.geometry.points },
    { kind: "curve", before: plan.geometry.curves ?? [], after: result.plan.geometry.curves ?? [] },
    { kind: "region", before: plan.geometry.regions ?? [], after: result.plan.geometry.regions ?? [] },
    { kind: "event", before: plan.events, after: result.plan.events },
    { kind: "section", before: plan.sections, after: result.plan.sections },
    { kind: "rule", before: plan.rules, after: result.plan.rules },
  ];
  const removed = groups.flatMap((group) => {
    const remaining = new Set(group.after.map((item) => item.id));
    const count = group.before.filter((item) => !(group.kind === selected.kind && item.id === selected.id) && !remaining.has(item.id)).length;
    return count === 0 ? [] : [`${count} ${group.kind}${count === 1 ? "" : "s"}`];
  });
  return { cascade: referencesTo(plan, selected).length > 0, summary: removed.join(", ") };
}

function DeleteSelection({ plan, selected, session, onOutcome }: {
  plan: Plan;
  selected: NonNullable<Selection>;
  session: TrajectorySession;
  onOutcome(outcome: EditOutcome): void;
}) {
  const [open, setOpen] = useState(false);
  const removal = open ? removalImpact(plan, selected) : null;
  return <details className="min-w-0 border-t border-line2 pt-3" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer text-small font-semibold text-ink2">Delete {selected.kind}</summary>
    {removal === null ? null : <div className="flex min-w-0 flex-col gap-3 pt-3">
      {removal.summary === "" ? null : <p className="m-0 text-small text-ink3">{removal.cascade ? "Also deletes dependent objects:" : "This also removes"} {removal.summary}.</p>}
      {removal.cascade ? <Button size="sm" variant="danger" icon="trash" className="self-start" onClick={() => onOutcome(session.execute({ type: "remove", selection: selected, cascade: true }))}>Delete with dependent objects</Button> : <Button size="sm" variant="danger" icon="trash" className="self-start" onClick={() => onOutcome(session.execute({ type: "remove", selection: selected }))}>Delete {selected.kind}</Button>}
    </div>}
  </details>;
}

export type PlanInspectorProps = {
  doc: TrajectoryDoc;
  plan: Plan;
  selected: Selection;
  session: TrajectorySession;
  onSelect(selection: Selection): void;
  onOutcome(outcome: EditOutcome): void;
};

export function PlanInspector({ doc, plan, selected, session, onSelect, onOutcome }: PlanInspectorProps) {
  const pointIndex = selected?.kind === "point" ? plan.geometry.points.findIndex((point) => point.id === selected.id) : -1;
  const curveIndex = selected?.kind === "curve" ? (plan.geometry.curves ?? []).findIndex((curve) => curve.id === selected.id) : -1;
  const regionIndex = selected?.kind === "region" ? (plan.geometry.regions ?? []).findIndex((region) => region.id === selected.id) : -1;
  const eventIndex = selected?.kind === "event" ? plan.events.findIndex((event) => event.id === selected.id) : -1;
  const sectionIndex = selected?.kind === "section" ? plan.sections.findIndex((section) => section.id === selected.id) : -1;
  const ruleIndex = selected?.kind === "rule" ? plan.rules.findIndex((rule) => rule.id === selected.id) : -1;
  const point = plan.geometry.points[pointIndex];
  const curve = plan.geometry.curves?.[curveIndex];
  const region = plan.geometry.regions?.[regionIndex];
  const event = plan.events[eventIndex];
  const section = plan.sections[sectionIndex];
  const rule = plan.rules[ruleIndex];
  const found = point ?? curve ?? region ?? event ?? section ?? rule;
  const linkedRuleIds = selected === null ? null : new Set(referencesTo(plan, selected).filter((item) => item.kind === "rule").map((item) => item.id));
  const linkedRules = linkedRuleIds === null ? plan.rules.filter((item) => "all" in item.scope) : plan.rules.filter((item) => linkedRuleIds.has(item.id));
  const replace = <T,>(read: (current: Plan) => T | undefined, command: (current: T) => PlanCommand) => {
    changeDocument(doc, () => {
      const current = planFrom(doc.editor.value([]));
      const entity = current === null ? undefined : read(current);
      if (entity !== undefined) onOutcome(session.execute(command(entity)));
    });
  };
  if (selected !== null && found === undefined) return (
    <>
      <InspectorHeading title="Selection unavailable" onBack={() => onSelect(null)} />
      <p className="m-0 text-small text-ink3">This object is unavailable. Select another object.</p>
    </>
  );
  return (
    <>
      <InspectorHeading title={selected === null ? "Trajectory plan" : `${selected.kind[0]?.toUpperCase() ?? ""}${selected.kind.slice(1)}`} id={selected?.id} onBack={selected === null ? undefined : () => onSelect(null)} />
      {selected === null ? (
        <>
          <TextField doc={doc.editor} path={["name"]} label="Plan name" />
          <InspectorDisclosure title="Coordinates" summary={plan.coordinates.altitude}>
            <p className="m-0 text-small text-ink2">WGS84 · latitude/longitude in degrees</p>
            <InspectorSelect doc={doc} path={["coordinates", "altitude"]} label="Altitude reference" options={[{ value: "EGM96", label: "EGM96 · Mean sea level" }, { value: "ellipsoid", label: "WGS84 ellipsoid" }]} />
          </InspectorDisclosure>
          <p className="m-0 text-small text-ink3">Select an object to edit its properties.</p>
          <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, [], "self")} />
        </>
      ) : point !== undefined ? <PointInspector doc={doc} index={pointIndex} />
        : curve !== undefined ? <CurveInspector doc={doc} plan={plan} value={curve} index={curveIndex} onReplace={(update) => replace((current) => current.geometry.curves?.find((item) => item.id === curve.id), (current) => ({ type: "replace-curve", id: current.id, curve: update(current) }))} />
        : region !== undefined ? <RegionInspector doc={doc} plan={plan} value={region} index={regionIndex} onReplace={(update) => replace((current) => current.geometry.regions?.find((item) => item.id === region.id), (current) => ({ type: "replace-region", id: current.id, region: update(current) }))} />
        : event !== undefined ? null
        : section !== undefined ? <SectionInspector doc={doc} plan={plan} index={sectionIndex} onReplace={(update) => replace((current) => current.sections.find((item) => item.id === section.id), (current) => ({ type: "replace-section", id: current.id, section: update(current) }))} />
        : rule !== undefined ? <RuleInspector doc={doc} plan={plan} rule={rule} index={ruleIndex} onReplace={(update) => replace((current) => current.rules.find((item) => item.id === rule.id), (current) => ({ type: "replace-rule", id: current.id, rule: update(current) }))} /> : null}
      {selected?.kind === "rule" ? null : (
        <InspectorSection title={selected === null ? "Global rules" : "Related rules"}>
          {linkedRules.length === 0 ? <p className="m-0 text-small text-ink3">No rules in this scope.</p> : (
            <div className="flex flex-col gap-1">
              {linkedRules.map((item) => (
                <button key={item.id} type="button" className="flex min-w-0 flex-col gap-0.5 rounded-key px-2 py-1.5 text-left hover:bg-hover" onClick={() => onSelect({ kind: "rule", id: item.id })}>
                  <span className="text-small font-medium">{ruleSummary(item)}</span>
                  {(selected?.kind === "event" && "event" in item.scope && item.scope.event === selected.id && item.scope.side === undefined) || (selected?.kind === "section" && "section" in item.scope && item.scope.section === selected.id) || (selected === null && "all" in item.scope) ? null : <span className="text-small text-ink3">{scopeSummary(item.scope)}</span>}
                </button>
              ))}
            </div>
          )}
          <Button size="xs" className="self-start" disabled={selected?.kind === "point" && plan.events.length === 0} onClick={() => onOutcome(session.addRule())}>{selected?.kind === "point" ? "Add position rule" : selected?.kind === "curve" ? "Add follow curve rule" : selected?.kind === "region" ? "Add inside region rule" : "Add rule"}</Button>
        </InspectorSection>
      )}
      <CurrentResult doc={doc} selected={selected} />
      {event === undefined ? null : <EventInspector key={event.id} doc={doc} plan={plan} event={event} index={eventIndex} onAddStop={(duration) => onOutcome(session.addStop(event.id, duration))} onReplaceState={(update) => replace(
        (current) => current.initialGuess?.states?.find((item) => item.event === event.id) ?? { event: event.id },
        (state) => ({ type: "set-initial-state", state: update(state) }),
      )} />}
      {selected === null ? null : <DeleteSelection key={`${selected.kind}:${selected.id}`} plan={plan} selected={selected} session={session} onOutcome={onOutcome} />}
    </>
  );
}
