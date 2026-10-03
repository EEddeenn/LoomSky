import type { Track } from "@/model/trajectory";
import type { Plan, PlanRule, PlanScope } from "@/model/trajectory";
import type { RuleMark, RuleValue, TimeRange } from "./chart";
import type { PlotSample } from "./plot";

export const quantities = [
  { key: "speed3d", field: "speed", label: "Speed", unit: "m/s" },
  { key: "acceleration3d", field: "acceleration", label: "Acceleration", unit: "m/s²" },
  { key: "altitude", field: "altitude", label: "Altitude", unit: "m" },
  { key: "jerk3d", field: "jerk", label: "Jerk", unit: "m/s³" },
] as const;
type ChartQuantity = typeof quantities[number]["key"];
export type EventMark = { id: string; time: number; estimated: boolean };
type SectionMark = { id: string; from: number; to: number };

export function numericValues(rule: PlanRule): RuleValue[] {
  if (!("quantity" in rule) || rule.kind === "objective") return [];
  if (rule.kind === "target") return typeof rule.value === "number" ? [{ field: "value", value: rule.value }] : [];
  if (typeof rule.eq === "number") return [{ field: "eq", value: rule.eq }];
  if (rule.range === undefined) return [];
  const values: RuleValue[] = [];
  if (typeof rule.range.min === "number") values.push({ field: "min", value: rule.range.min });
  if (typeof rule.range.max === "number") values.push({ field: "max", value: rule.range.max });
  return values;
}

export function schedule(plan: Plan | null, track: Track | null): { duration: number; events: EventMark[]; sections: SectionMark[] } {
  const times = new Map<string, number>();
  const actual = new Set<string>();
  let duration = Math.max(0, track?.duration ?? 0);
  for (const event of track?.inspection?.events ?? []) {
    if (!Number.isFinite(event.time)) continue;
    times.set(event.id, event.time);
    actual.add(event.id);
    duration = Math.max(duration, event.time);
  }
  for (const [id, time] of Object.entries(plan?.initialGuess?.eventTimes ?? {})) {
    if (times.has(id)) continue;
    times.set(id, time);
    duration = Math.max(duration, time);
  }
  for (const rule of plan?.rules ?? []) {
    if ("time" in rule.scope) duration = Math.max(duration, rule.scope.time);
    if ("timeRange" in rule.scope) duration = Math.max(duration, ...rule.scope.timeRange);
    if (!("quantity" in rule) || rule.quantity !== "time") continue;
    const values = numericValues(rule);
    for (const numeric of values) duration = Math.max(duration, numeric.value);
    if (!("event" in rule.scope)) continue;
    const time = values.find(({ field }) => field === "eq" || field === "value")?.value;
    if (time !== undefined && !actual.has(rule.scope.event) && (rule.kind === "hard" || !times.has(rule.scope.event))) times.set(rule.scope.event, time);
  }
  const first = plan?.events[0];
  if (first !== undefined && !times.has(first.id)) times.set(first.id, 0);
  for (let pass = 0; pass < (plan?.events.length ?? 0); pass++) {
    let changed = false;
    for (const rule of plan?.rules ?? []) {
      if (!("quantity" in rule) || rule.kind !== "hard" || rule.quantity !== "duration" || typeof rule.eq !== "number") continue;
      const section = "section" in rule.scope ? plan?.sections.find((section) => "section" in rule.scope && section.id === rule.scope.section) : undefined;
      const pair = section !== undefined ? [section.from, section.to] : "between" in rule.scope ? rule.scope.between
        : "all" in rule.scope ? [plan?.events[0]?.id, plan?.events[(plan?.events.length ?? 1) - 1]?.id] : null;
      const fromId = pair?.[0];
      const toId = pair?.[1];
      if (fromId === undefined || toId === undefined) continue;
      const from = times.get(fromId);
      const to = times.get(toId);
      if (from !== undefined && to === undefined) { times.set(toId, from + rule.eq); changed = true; }
      if (to !== undefined && from === undefined) { times.set(fromId, Math.max(0, to - rule.eq)); changed = true; }
    }
    if (!changed) break;
  }
  for (const time of times.values()) duration = Math.max(duration, time);
  const events = (plan?.events ?? []).flatMap((event) => {
    const time = times.get(event.id);
    return time === undefined ? [] : [{ id: event.id, time, estimated: !actual.has(event.id) }];
  });
  const eventTimes = new Map(events.map((event) => [event.id, event.time]));
  const sections = (plan?.sections ?? []).flatMap((section) => {
    const inspection = track?.inspection?.sections.find((item) => item.id === section.id);
    const from = inspection?.start ?? eventTimes.get(section.from);
    const to = inspection?.end ?? eventTimes.get(section.to);
    return from === undefined || to === undefined ? [] : [{ id: section.id, from, to }];
  });
  return { duration, events, sections };
}

export function scopeRange(scope: PlanScope, events: readonly EventMark[], sections: readonly SectionMark[], duration: number): TimeRange | null {
  if ("all" in scope) return { from: 0, to: duration };
  if ("time" in scope) return { from: scope.time, to: scope.time };
  if ("timeRange" in scope) return { from: scope.timeRange[0], to: scope.timeRange[1] };
  if ("section" in scope) {
    const section = sections.find((section) => section.id === scope.section);
    return section === undefined ? null : { from: section.from, to: section.to };
  }
  if ("event" in scope) {
    const event = events.find((event) => event.id === scope.event);
    return event === undefined ? null : { from: event.time, to: event.time };
  }
  const from = events.find((event) => event.id === scope.between[0]);
  const to = events.find((event) => event.id === scope.between[1]);
  return from === undefined || to === undefined ? null : { from: from.time, to: to.time };
}

export function ruleMarks(plan: Plan | null, quantity: ChartQuantity, events: readonly EventMark[], sections: readonly SectionMark[], duration: number): RuleMark[] {
  return (plan?.rules ?? []).flatMap((rule) => {
    if (!("quantity" in rule) || rule.quantity !== quantity || rule.kind === "objective") return [];
    const range = scopeRange(rule.scope, events, sections, duration);
    const values = numericValues(rule);
    return range === null || values.length === 0 ? [] : [{ id: rule.id, label: rule.id, kind: rule.kind, ...range, values }];
  });
}

export function plotSamples(track: Track | null, quantity: ChartQuantity): PlotSample[] {
  const field = quantities.find((item) => item.key === quantity)?.field ?? "speed";
  return (track?.inspection?.samples ?? []).map((sample) => ({ time: sample.time, value: sample[field] }));
}
