import type {
  Plan, PlanCurve, PlanEvent, PlanInitialState, PlanPoint, PlanPosition, PlanQuantity,
  PlanRegion, PlanRule, PlanScope, PlanSection, PlanValue, PlanVector,
} from "./source";
import type { TrajectoryInspection } from "../inspection";
import { directionPoint, pointPosition, vector } from "../geometry";

export type PlanEntityKind = "point" | "curve" | "region" | "event" | "section" | "rule";
export type PlanEntity = { kind: PlanEntityKind; id: string };
export type PlanEditMode = "hard" | "target" | "initial";

type Target = { scope: PlanScope; quantity: PlanQuantity; value: PlanValue; mode?: PlanEditMode; ruleId?: string };
export type PlanCommand =
  | { type: "draw-geometry"; kind: "bezier" | "polyline" | "circle" | "polygon"; positions: readonly PlanPosition[] }
  | { type: "add-point"; point: PlanPoint }
  | { type: "move-point"; id: string; position: Pick<PlanPosition, "latitude" | "longitude"> & Partial<Pick<PlanPosition, "altitude">> }
  | { type: "replace-curve"; id: string; curve: PlanCurve }
  | { type: "replace-region"; id: string; region: PlanRegion }
  | { type: "add-event"; event: PlanEvent; after?: string; time?: number }
  | { type: "add-section"; section: PlanSection }
  | { type: "replace-section"; id: string; section: PlanSection }
  | { type: "add-rule"; rule: PlanRule }
  | { type: "replace-rule"; id: string; rule: PlanRule }
  | { type: "set-rule-value"; id: string; field: "eq" | "value" | "min" | "max"; value: PlanValue }
  | { type: "set-event-time"; id: string; time: number; mode?: PlanEditMode; ruleId?: string }
  | ({ type: "target" } & Target)
  | { type: "position-target"; scope: PlanScope; position: PlanPosition; mode?: PlanEditMode; ruleId?: string }
  | { type: "set-initial-state"; state: PlanInitialState }
  | { type: "add-stop"; eventId: string; duration: number }
  | { type: "remove"; selection: PlanEntity; cascade?: boolean };
type CommandContext = { mode?: PlanEditMode; inspection?: TrajectoryInspection | null };
type CommandResult = { ok: true; plan: Plan; selection?: PlanEntity | null } | { ok: false; message: string };
type Applied = { selection?: PlanEntity | null };

class CommandError extends Error {}

function requireEntity<T extends { id: string }>(items: readonly T[], id: string): T {
  const found = items.filter((item) => item.id === id);
  const first = found[0];
  if (found.length !== 1 || first === undefined) throw new CommandError(found.length === 0 ? `Object ${id} is no longer available.` : `ID ${id} is duplicated. Fix it before editing.`);
  return first;
}

function add<T extends { id: string }>(items: T[], item: T): void {
  if (item.id.trim() === "" || items.some((existing) => existing.id === item.id)) throw new CommandError("Enter a nonempty, unique object ID.");
  items.push(structuredClone(item));
}

function replace<T extends { id: string }>(items: T[], id: string, item: T): void {
  const existing = requireEntity(items, id);
  if (item.id !== id) throw new CommandError("Keep this object's ID when editing its properties.");
  items[items.indexOf(existing)] = structuredClone(item);
}

export function freshPlanId(plan: Plan, prefix: string): string {
  const used = new Set([
    ...plan.geometry.points, ...(plan.geometry.curves ?? []), ...(plan.geometry.regions ?? []),
    ...plan.events, ...plan.sections, ...plan.rules,
  ].map((item) => item.id));
  let id = prefix;
  for (let suffix = 2; used.has(id); suffix++) id = `${prefix}-${suffix}`;
  return id;
}

export function selectionExists(plan: Plan, selection: PlanEntity | null): boolean {
  return selection === null || entities(plan, selection.kind).some((item) => item.id === selection.id);
}

function entities(plan: Plan, kind: PlanEntity["kind"]): readonly { id: string }[] {
  switch (kind) {
    case "point": return plan.geometry.points;
    case "curve": return plan.geometry.curves ?? [];
    case "region": return plan.geometry.regions ?? [];
    case "event": return plan.events;
    case "section": return plan.sections;
    case "rule": return plan.rules;
  }
}

export function applyPlanCommand(source: Plan, command: PlanCommand, context: CommandContext = {}): CommandResult {
  const plan = structuredClone(source);
  try {
    return { ok: true, plan, ...apply(plan, command, context) };
  } catch (error) {
    if (error instanceof CommandError) return { ok: false, message: error.message };
    throw error;
  }
}

function apply(plan: Plan, command: PlanCommand, context: CommandContext): Applied {
  switch (command.type) {
    case "draw-geometry": return drawGeometry(plan, command.kind, command.positions);
    case "add-point": add(plan.geometry.points, command.point); return { selection: { kind: "point", id: command.point.id } };
    case "move-point": {
      const point = requireEntity(plan.geometry.points, command.id);
      point.position = { ...point.position, ...command.position };
      return {};
    }
    case "replace-curve": replace(plan.geometry.curves ?? [], command.id, command.curve); return {};
    case "replace-region": replace(plan.geometry.regions ?? [], command.id, command.region); return {};
    case "add-event": return insertEvent(plan, command.event, command.after, command.time);
    case "add-section": {
      requireEntity(plan.events, command.section.from);
      requireEntity(plan.events, command.section.to);
      const index = plan.events.findIndex((event) => event.id === command.section.from);
      if (plan.events[index + 1]?.id !== command.section.to) throw new CommandError("Sections must connect adjacent events in order.");
      if (plan.sections.some((section) => section.from === command.section.from || section.to === command.section.to)) throw new CommandError("These events already have a section. Select it to edit.");
      add(plan.sections, command.section);
      orderSections(plan);
      return { selection: { kind: "section", id: command.section.id } };
    }
    case "replace-section": {
      const index = plan.events.findIndex((event) => event.id === command.section.from);
      if (index < 0 || plan.events[index + 1]?.id !== command.section.to) throw new CommandError("Sections must connect adjacent events in order.");
      if (plan.sections.some((section) => section.id !== command.id && (section.from === command.section.from || section.to === command.section.to))) throw new CommandError("Another section already connects these events.");
      replace(plan.sections, command.id, command.section);
      orderSections(plan);
      return {};
    }
    case "add-rule": add(plan.rules, command.rule); return { selection: { kind: "rule", id: command.rule.id } };
    case "replace-rule": replace(plan.rules, command.id, command.rule); return {};
    case "set-rule-value": {
      const rule = requireEntity(plan.rules, command.id);
      if (!("quantity" in rule)) throw new CommandError("This relation has no numeric target field.");
      if (command.field === "value" && rule.kind === "target") rule.value = structuredClone(command.value);
      else if (command.field === "eq" && rule.kind === "hard" && rule.eq !== undefined) rule.eq = structuredClone(command.value);
      else if ((command.field === "min" || command.field === "max") && rule.kind === "hard" && rule.range !== undefined) rule.range[command.field] = structuredClone(command.value);
      else throw new CommandError("This rule no longer uses that value field.");
      return {};
    }
    case "set-event-time": {
      requireEntity(plan.events, command.id);
      return target(plan, { scope: { event: command.id }, quantity: "time", value: command.time, mode: command.mode, ruleId: command.ruleId }, context);
    }
    case "target": return target(plan, command, context);
    case "position-target": {
      const mode = command.mode ?? context.mode ?? "target";
      if (mode === "initial") {
        const event = scopeEvent(plan, command.scope);
        initialState(plan, event, context).position = structuredClone(command.position);
        return { selection: { kind: "event", id: event } };
      }
      const point: PlanPoint = { id: freshPlanId(plan, "position-goal"), position: structuredClone(command.position) };
      add(plan.geometry.points, point);
      return target(plan, { scope: command.scope, quantity: "position", value: { point: point.id }, mode, ruleId: command.ruleId }, context);
    }
    case "set-initial-state": {
      requireEntity(plan.events, command.state.event);
      const states = (plan.initialGuess ??= {}).states ??= [];
      const index = states.findIndex((state) => state.event === command.state.event);
      if (index < 0) states.push(structuredClone(command.state));
      else states[index] = structuredClone(command.state);
      return {};
    }
    case "add-stop": return addStop(plan, command.eventId, command.duration, context);
    case "remove": return remove(plan, command.selection, command.cascade ?? false);
  }
}

function orderSections(plan: Plan): void {
  const order = new Map(plan.events.map((event, index) => [event.id, index]));
  plan.sections.sort((left, right) => (order.get(left.from) ?? Infinity) - (order.get(right.from) ?? Infinity));
}

function eventTime(plan: Plan, id: string, context: CommandContext): number | undefined {
  const times = plan.initialGuess?.eventTimes;
  const initial = times !== undefined && Object.hasOwn(times, id) ? times[id] : undefined;
  return context.inspection?.events.find((event) => event.id === id)?.time ?? initial
    ?? plan.rules.flatMap((rule) => "quantity" in rule && rule.quantity === "time" && "event" in rule.scope && rule.scope.event === id
      ? rule.kind === "hard" && typeof rule.eq === "number" ? [rule.eq] : rule.kind === "target" && typeof rule.value === "number" ? [rule.value] : [] : [])[0];
}

function insertEvent(plan: Plan, event: PlanEvent, after: string | undefined, time: number | undefined): Applied {
  if (plan.events.some((existing) => existing.id === event.id) || event.id.trim() === "") throw new CommandError("Enter a nonempty, unique event ID.");
  const before = after === undefined ? plan.events.at(-1) : requireEntity(plan.events, after);
  const index = before === undefined ? 0 : plan.events.indexOf(before) + 1;
  const next = plan.events[index];
  const previousSection = before === undefined || next === undefined ? undefined : plan.sections.find((section) => section.from === before.id && section.to === next.id);
  plan.events.splice(index, 0, structuredClone(event));
  if (before !== undefined) {
    if (previousSection !== undefined) {
      for (const rule of plan.rules) if ("section" in rule.scope && rule.scope.section === previousSection.id) rule.scope = { between: [previousSection.from, previousSection.to] };
      previousSection.to = event.id;
    } else add(plan.sections, { id: freshPlanId(plan, "section"), from: before.id, to: event.id });
  }
  if (next !== undefined) add(plan.sections, { id: freshPlanId(plan, "section"), from: event.id, to: next.id });
  orderSections(plan);
  if (time !== undefined) {
    const guess = plan.initialGuess ??= {};
    guess.eventTimes = { ...guess.eventTimes, [event.id]: time };
  }
  return { selection: { kind: "event", id: event.id } };
}

function target(plan: Plan, change: Target, context: CommandContext): Applied {
  const mode = change.mode ?? context.mode ?? "target";
  if (mode === "initial") return seed(plan, change.scope, change.quantity, change.value, context);
  if (change.ruleId !== undefined) {
    const rule = requireEntity(plan.rules, change.ruleId);
    if (!("quantity" in rule) || rule.quantity !== change.quantity) throw new CommandError("The selected rule does not control this quantity.");
    if (rule.kind === "target") rule.value = structuredClone(change.value);
    else if (rule.kind === "hard" && rule.eq !== undefined) rule.eq = structuredClone(change.value);
    else throw new CommandError("Select an equality or target rule to move this value.");
    return { selection: { kind: "rule", id: rule.id } };
  }
  const id = freshPlanId(plan, `${change.quantity}-goal`);
  const base = { id, scope: structuredClone(change.scope), quantity: change.quantity };
  add(plan.rules, mode === "hard"
    ? { ...base, kind: "hard", eq: structuredClone(change.value) }
    : { ...base, kind: "target", value: structuredClone(change.value) });
  return { selection: { kind: "rule", id } };
}

function scopeEvent(plan: Plan, scope: PlanScope): string {
  if (!("event" in scope)) throw new CommandError("Select an event for an initial state. Use a target or hard constraint for a time or interval.");
  requireEntity(plan.events, scope.event);
  return scope.event;
}

function initialState(plan: Plan, event: string, context: CommandContext): PlanInitialState {
  const states = (plan.initialGuess ??= {}).states ??= [];
  let state = states.find((item) => item.event === event);
  if (state === undefined) {
    const solved = context.inspection?.events.find((item) => item.id === event);
    state = solved === undefined ? { event } : {
      event, position: { latitude: solved.latitude, longitude: solved.longitude, altitude: solved.altitude },
      velocityEcef: [...solved.velocityEcef], accelerationEcef: [...solved.accelerationEcef], course: solved.course,
    };
    states.push(state);
  }
  return state;
}

function seed(plan: Plan, scope: PlanScope, quantity: PlanQuantity, value: PlanValue, context: CommandContext): Applied {
  const event = scopeEvent(plan, scope);
  if (quantity === "time" && typeof value === "number") {
    const guess = plan.initialGuess ??= {};
    guess.eventTimes = { ...guess.eventTimes, [event]: value };
  } else {
    const state = initialState(plan, event, context);
    if (quantity === "position" && !Array.isArray(value) && typeof value === "object" && "point" in value) state.position = structuredClone(requireEntity(plan.geometry.points, value.point).position);
    else if (quantity === "velocityEcef" && Array.isArray(value)) state.velocityEcef = [...value];
    else if (quantity === "accelerationEcef" && Array.isArray(value)) state.accelerationEcef = [...value];
    else if (quantity === "course" && typeof value === "number") state.course = value;
    else if (quantity === "altitude" && typeof value === "number" && state.position !== undefined) state.position.altitude = value;
    else if (quantity === "speed3d" && typeof value === "number") state.velocityEcef = scaledVector(state.velocityEcef, value);
    else if (quantity === "acceleration3d" && typeof value === "number") state.accelerationEcef = scaledVector(state.accelerationEcef, value);
    else throw new CommandError("Use a target or hard constraint for this quantity. Initial states support position, velocity, acceleration and course at an event.");
  }
  return { selection: { kind: "event", id: event } };
}

function scaledVector(vector: PlanVector | undefined, magnitude: number): PlanVector {
  if (!(magnitude >= 0 && Number.isFinite(magnitude))) throw new CommandError("Enter a finite nonnegative magnitude.");
  const norm = vector === undefined ? 0 : Math.hypot(...vector);
  if (vector === undefined || norm === 0) {
    if (magnitude === 0) return [0, 0, 0];
    throw new CommandError("Set an initial vector direction before changing its magnitude.");
  }
  return [vector[0] * magnitude / norm, vector[1] * magnitude / norm, vector[2] * magnitude / norm];
}

function addStop(plan: Plan, eventId: string, duration: number, context: CommandContext): Applied {
  requireEntity(plan.events, eventId);
  if (!(duration > 0 && Number.isFinite(duration))) throw new CommandError("Enter a positive, finite stop duration.");
  const departure = freshPlanId(plan, "departure");
  const arrival = eventTime(plan, eventId, context);
  insertEvent(plan, { id: departure }, eventId, arrival === undefined ? undefined : arrival + duration);
  const section = plan.sections.find((item) => item.from === eventId && item.to === departure);
  if (section === undefined) throw new CommandError("Could not create the stop interval.");
  add(plan.rules, { id: freshPlanId(plan, "hold"), kind: "hard", scope: { section: section.id }, quantity: "speed3d", eq: 0 });
  add(plan.rules, { id: freshPlanId(plan, "stop-duration"), kind: "hard", scope: { section: section.id }, quantity: "duration", eq: duration });
  return { selection: { kind: "section", id: section.id } };
}

function scopeReferences(scope: PlanScope, selection: PlanEntity): boolean {
  return selection.kind === "event" ? ("event" in scope && scope.event === selection.id) || ("between" in scope && scope.between.includes(selection.id))
    : selection.kind === "section" && "section" in scope && scope.section === selection.id;
}

function valueReferences(value: PlanValue | undefined, selection: PlanEntity): boolean {
  if (value === undefined || typeof value !== "object" || Array.isArray(value)) return false;
  return selection.kind === "point" ? "point" in value && value.point === selection.id
    : selection.kind === "event" && "event" in value && value.event === selection.id;
}

function ruleReferences(rule: PlanRule, selection: PlanEntity): boolean {
  if (scopeReferences(rule.scope, selection)) return true;
  if ("relation" in rule) return selection.kind === "curve" ? rule.relation.type === "followCurve" && rule.relation.curve === selection.id
    : selection.kind === "region" && rule.relation.type === "insideRegion" && rule.relation.region === selection.id;
  if (rule.kind === "target") return valueReferences(rule.value, selection);
  return rule.kind === "hard" && (valueReferences(rule.eq, selection) || valueReferences(rule.range?.min, selection) || valueReferences(rule.range?.max, selection));
}

export function referencesTo(plan: Plan, selection: PlanEntity): PlanEntity[] {
  const found: PlanEntity[] = plan.rules.filter((rule) => ruleReferences(rule, selection)).map((rule) => ({ kind: "rule", id: rule.id }));
  if (selection.kind === "point") {
    for (const curve of plan.geometry.curves ?? []) if (curve.points.includes(selection.id)) found.push({ kind: "curve", id: curve.id });
    for (const region of plan.geometry.regions ?? []) if (region.type === "circle" ? region.center === selection.id : region.points.includes(selection.id)) found.push({ kind: "region", id: region.id });
  }
  if (selection.kind === "event") {
    for (const section of plan.sections.filter((item) => item.from === selection.id || item.to === selection.id)) {
      for (const rule of plan.rules) if (ruleReferences(rule, { kind: "section", id: section.id })) found.push({ kind: "rule", id: rule.id });
    }
  }
  return found.filter((item, index) => found.findIndex((other) => item.kind === other.kind && item.id === other.id) === index);
}

function remove(plan: Plan, selection: PlanEntity, cascade: boolean): Applied {
  requireEntity(entities(plan, selection.kind), selection.id);
  const references = referencesTo(plan, selection);
  if (!cascade && references.length > 0) throw new CommandError(`${selection.id} is used by ${references.map((item) => item.id).join(", ")}. Remove these objects together, or update their references first.`);
  for (const dependent of references) if (selectionExists(plan, dependent)) remove(plan, dependent, true);
  switch (selection.kind) {
    case "point": plan.geometry.points = plan.geometry.points.filter((point) => point.id !== selection.id); break;
    case "curve": plan.geometry.curves = (plan.geometry.curves ?? []).filter((curve) => curve.id !== selection.id); break;
    case "region": plan.geometry.regions = (plan.geometry.regions ?? []).filter((region) => region.id !== selection.id); break;
    case "rule": plan.rules = plan.rules.filter((rule) => rule.id !== selection.id); break;
    case "section": plan.sections = plan.sections.filter((section) => section.id !== selection.id); break;
    case "event": {
      const before = plan.sections.find((section) => section.to === selection.id);
      const after = plan.sections.find((section) => section.from === selection.id);
      plan.sections = plan.sections.filter((section) => section.from !== selection.id && section.to !== selection.id);
      plan.events = plan.events.filter((event) => event.id !== selection.id);
      if (before !== undefined && after !== undefined) plan.sections.push({ id: before.id, from: before.from, to: after.to });
      orderSections(plan);
      if (plan.initialGuess?.eventTimes !== undefined) delete plan.initialGuess.eventTimes[selection.id];
      if (plan.initialGuess?.states !== undefined) plan.initialGuess.states = plan.initialGuess.states.filter((state) => state.event !== selection.id);
      break;
    }
  }
  return { selection: null };
}

function drawGeometry(plan: Plan, kind: "bezier" | "polyline" | "circle" | "polygon", positions: readonly PlanPosition[]): Applied {
  if (kind === "bezier" && positions.length !== 2 || kind === "polyline" && positions.length < 2
    || kind === "circle" && positions.length !== 2 || kind === "polygon" && positions.length < 3) {
    throw new CommandError("Check the point count for this geometry.");
  }
  if (kind === "bezier") {
    const start = positions[0];
    const end = positions[1];
    if (start === undefined || end === undefined) throw new CommandError("Place both curve endpoints.");
    const origin = { lat: start.latitude, lon: start.longitude };
    const travel = vector(origin, { lat: end.latitude, lon: end.longitude });
    const controls = [1 / 3, 2 / 3].map((fraction) => {
      const point = directionPoint(origin, travel.course, travel.length * fraction);
      return { latitude: point.lat, longitude: point.lon, altitude: start.altitude + (end.altitude - start.altitude) * fraction };
    });
    positions = [start, ...controls, end];
  }
  const points = positions.map((position) => {
    const point = { id: freshPlanId(plan, "point"), position: structuredClone(position) };
    plan.geometry.points.push(point);
    return point;
  });
  const ids = points.map((point) => point.id);
  const id = freshPlanId(plan, kind === "bezier" || kind === "polyline" ? "curve" : "region");
  if (kind === "bezier" || kind === "polyline") {
    (plan.geometry.curves ??= []).push({ id, type: kind, points: ids });
    return { selection: { kind: "curve", id } };
  }
  const origin = points[0];
  if (origin === undefined) throw new CommandError("Place the geometry origin first.");
  if (kind === "circle") {
    const edge = points[1];
    if (edge === undefined) throw new CommandError("Place a point to set the radius.");
    plan.geometry.points.pop();
    (plan.geometry.regions ??= []).push({ id, type: "circle", center: origin.id, radius: Math.max(0.01, vector(pointPosition(origin), pointPosition(edge)).length) });
  } else {
    const offsets = points.map((point) => vector(pointPosition(origin), pointPosition(point)));
    let direction = 0;
    for (let index = 0; index < offsets.length; index++) {
      const a = offsets[index];
      const b = offsets[(index + 1) % offsets.length];
      if (a === undefined || b === undefined) continue;
      for (let other = 0; other < offsets.length; other++) {
        if (other === index || other === (index + 1) % offsets.length) continue;
        const c = offsets[other];
        if (c === undefined) continue;
        const cross = (b.east - a.east) * (c.north - a.north) - (b.north - a.north) * (c.east - a.east);
        if (Math.abs(cross) < 1e-6 || direction !== 0 && Math.sign(cross) !== direction) {
          throw new CommandError("Place corners in order around a convex polygon. Remove the last corner to adjust.");
        }
        direction = Math.sign(cross);
      }
    }
    (plan.geometry.regions ??= []).push({ id, type: "polygon", points: ids });
  }
  return { selection: { kind: "region", id } };
}
