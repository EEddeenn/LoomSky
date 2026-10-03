import { isRecord } from "@/core";

export type PlanVector = [number, number, number];
export type PlanPosition = { latitude: number; longitude: number; altitude: number };
export type PlanPoint = { id: string; position: PlanPosition };
export type PlanCurve = { id: string; type: "bezier" | "polyline"; points: string[] };
export type PlanRegion =
  | { id: string; type: "circle"; center: string; radius: number }
  | { id: string; type: "polygon"; points: string[] };
export type PlanEvent = { id: string; continuity?: "C0" | "C1" | "C2" };
export type PlanSection = { id: string; from: string; to: string };
type PlanSide = "in" | "out";
export type PlanScope =
  | { event: string; side?: PlanSide }
  | { section: string }
  | { between: [string, string] }
  | { time: number }
  | { timeRange: [number, number] }
  | { all: true };

export const planQuantities = [
  "time", "duration", "speed3d", "horizontalSpeed", "forwardSpeed", "forwardAcceleration", "forwardJerk",
  "climbRate", "verticalAcceleration", "acceleration3d", "jerk3d", "altitude", "course", "turnRate",
  "lateralAcceleration", "turnRadius", "position", "velocityEcef", "accelerationEcef",
] as const;
export type PlanQuantity = typeof planQuantities[number];
export type PlanValue = number | PlanVector | { point: string } | {
  event: string;
  quantity: PlanQuantity;
  side?: PlanSide;
  factor?: number;
  offset?: number;
};
type PlanRange = { min?: PlanValue; max?: PlanValue };
type PlanRelation =
  | { type: "followCurve"; curve: string; from?: number; to?: number; tolerance?: number }
  | { type: "insideRegion"; region: string };
type RuleBase = { id: string; scope: PlanScope; scale?: number };
type PlanHardRule = RuleBase & { kind: "hard"; quantity: PlanQuantity } & (
  | { eq: PlanValue; range?: never }
  | { range: PlanRange; eq?: never }
);
type PlanTargetRule = RuleBase & { kind: "target"; quantity: PlanQuantity; value: PlanValue; weight?: number };
type PlanObjectiveRule = RuleBase & {
  kind: "objective";
  quantity: PlanQuantity;
  reduce?: "value" | "meanSquare" | "integralSquare";
  sense?: "minimize" | "maximize";
  weight?: number;
};
type PlanRelationRule = RuleBase & { kind: "hard" | "target"; relation: PlanRelation; weight?: number };
export type PlanRule = PlanHardRule | PlanTargetRule | PlanObjectiveRule | PlanRelationRule;
export type PlanInitialState = {
  event: string;
  position?: PlanPosition;
  velocityEcef?: PlanVector;
  accelerationEcef?: PlanVector;
  course?: number;
};
export type PlanInitialGuess = { eventTimes?: Record<string, number>; states?: PlanInitialState[] };
export type Plan = {
  format: "pharos.trajectory-plan";
  version: 1;
  name?: string;
  coordinates: { datum: "WGS84"; altitude: "EGM96" | "ellipsoid" };
  geometry: { points: PlanPoint[]; curves?: PlanCurve[]; regions?: PlanRegion[] };
  events: PlanEvent[];
  sections: PlanSection[];
  rules: PlanRule[];
  initialGuess?: PlanInitialGuess;
};
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const named = (value: unknown): value is Record<string, unknown> & { id: string } => isRecord(value) && typeof value.id === "string";
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const vector = (value: unknown): value is PlanVector => Array.isArray(value) && value.length === 3 && value.every(finite);
const position = (value: unknown): value is PlanPosition => isRecord(value) && finite(value.latitude) && finite(value.longitude) && finite(value.altitude);

export function planFrom(value: unknown): Plan | null {
  if (!isRecord(value) || value.format !== "pharos.trajectory-plan" || value.version !== 1 || (value.name !== undefined && typeof value.name !== "string")) return null;
  const coordinates = value.coordinates;
  if (!isRecord(coordinates) || coordinates.datum !== "WGS84" || (coordinates.altitude !== "EGM96" && coordinates.altitude !== "ellipsoid")) return null;
  const geometry = value.geometry;
  if (!isRecord(geometry) || !Array.isArray(geometry.points) || !geometry.points.every((point) => named(point) && position(point.position))) return null;
  if (geometry.curves !== undefined && (!Array.isArray(geometry.curves) || !geometry.curves.every((curve) => named(curve) && (curve.type === "bezier" || curve.type === "polyline") && strings(curve.points)))) return null;
  if (geometry.regions !== undefined && (!Array.isArray(geometry.regions) || !geometry.regions.every((region) => named(region) && (region.type === "circle" ? typeof region.center === "string" && finite(region.radius) : region.type === "polygon" && strings(region.points))))) return null;
  if (!Array.isArray(value.events) || !value.events.every((event) => named(event) && (event.continuity === undefined || event.continuity === "C0" || event.continuity === "C1" || event.continuity === "C2"))) return null;
  if (!Array.isArray(value.sections) || !value.sections.every((section) => named(section) && typeof section.from === "string" && typeof section.to === "string")) return null;
  if (!Array.isArray(value.rules) || !value.rules.every(ruleShape)) return null;
  const guess = value.initialGuess;
  if (guess !== undefined) {
    if (!isRecord(guess)) return null;
    if (guess.eventTimes !== undefined && (!isRecord(guess.eventTimes) || !Object.values(guess.eventTimes).every(finite))) return null;
    if (guess.states !== undefined && (!Array.isArray(guess.states) || !guess.states.every((state) => isRecord(state) && typeof state.event === "string"
      && (state.position === undefined || position(state.position)) && (state.velocityEcef === undefined || vector(state.velocityEcef))
      && (state.accelerationEcef === undefined || vector(state.accelerationEcef)) && (state.course === undefined || finite(state.course))))) return null;
  }
  return value as Plan;
}

function scopeShape(value: unknown): boolean {
  if (!isRecord(value) || ["event", "section", "between", "time", "timeRange", "all"].filter((key) => key in value).length !== 1) return false;
  if ("event" in value) return typeof value.event === "string" && (value.side === undefined || value.side === "in" || value.side === "out");
  if ("side" in value) return false;
  if ("section" in value) return typeof value.section === "string";
  if ("between" in value) return strings(value.between) && value.between.length === 2;
  if ("time" in value) return finite(value.time);
  if ("timeRange" in value) return Array.isArray(value.timeRange) && value.timeRange.length === 2 && value.timeRange.every(finite);
  return value.all === true;
}

function quantityShape(value: unknown): value is PlanQuantity {
  return planQuantities.some((quantity) => quantity === value);
}

function valueShape(value: unknown): boolean {
  if (finite(value) || vector(value)) return true;
  if (!isRecord(value)) return false;
  if ("point" in value) return typeof value.point === "string" && !["event", "quantity", "side", "factor", "offset"].some((key) => key in value);
  return typeof value.event === "string" && quantityShape(value.quantity)
    && (value.side === undefined || value.side === "in" || value.side === "out")
    && (value.factor === undefined || finite(value.factor)) && (value.offset === undefined || finite(value.offset));
}

function ruleShape(value: unknown): boolean {
  if (!named(value) || !scopeShape(value.scope) || (value.scale !== undefined && !finite(value.scale)) || (value.weight !== undefined && !finite(value.weight))) return false;
  if (("relation" in value) === ("quantity" in value)) return false;
  if ("relation" in value) {
    if ((value.kind !== "hard" && value.kind !== "target") || ["eq", "range", "value", "reduce", "sense"].some((key) => key in value)) return false;
    const relation = value.relation;
    if (!isRecord(relation)) return false;
    return relation.type === "insideRegion" ? typeof relation.region === "string"
      : relation.type === "followCurve" && typeof relation.curve === "string"
        && (relation.from === undefined || finite(relation.from)) && (relation.to === undefined || finite(relation.to))
        && (relation.tolerance === undefined || finite(relation.tolerance));
  }
  if (!quantityShape(value.quantity)) return false;
  if (value.kind === "hard") {
    if (("eq" in value) === ("range" in value) || ["value", "reduce", "sense"].some((key) => key in value)) return false;
    return "eq" in value ? valueShape(value.eq) : isRecord(value.range)
      && (value.range.min === undefined || valueShape(value.range.min)) && (value.range.max === undefined || valueShape(value.range.max));
  }
  if ("eq" in value || "range" in value) return false;
  if (value.kind === "target") return !("reduce" in value) && !("sense" in value) && valueShape(value.value);
  return value.kind === "objective" && !("value" in value)
    && (value.reduce === undefined || value.reduce === "value" || value.reduce === "meanSquare" || value.reduce === "integralSquare")
    && (value.sense === undefined || value.sense === "minimize" || value.sense === "maximize");
}

export function createPlan(name: string): Plan {
  return {
    format: "pharos.trajectory-plan", version: 1, name,
    coordinates: { datum: "WGS84", altitude: "EGM96" },
    geometry: { points: [] },
    events: [],
    sections: [],
    rules: [],
  };
}
