import { trimmed } from "@/core";
import type { PlanQuantity, PlanRule, PlanScope, PlanValue } from "@/model/trajectory";

const quantities: Record<PlanQuantity, { label: string; unit: string }> = {
  time: { label: "Time", unit: "s" },
  duration: { label: "Duration", unit: "s" },
  speed3d: { label: "Speed", unit: "m/s" },
  horizontalSpeed: { label: "Horizontal speed", unit: "m/s" },
  forwardSpeed: { label: "Forward speed", unit: "m/s" },
  forwardAcceleration: { label: "Forward acceleration", unit: "m/s²" },
  forwardJerk: { label: "Forward jerk", unit: "m/s³" },
  climbRate: { label: "Climb rate", unit: "m/s" },
  verticalAcceleration: { label: "Vertical acceleration", unit: "m/s²" },
  acceleration3d: { label: "Acceleration", unit: "m/s²" },
  jerk3d: { label: "Jerk", unit: "m/s³" },
  altitude: { label: "Altitude", unit: "m" },
  course: { label: "Course", unit: "°" },
  turnRate: { label: "Turn rate", unit: "°/s" },
  lateralAcceleration: { label: "Lateral acceleration", unit: "m/s²" },
  turnRadius: { label: "Turn radius", unit: "m" },
  position: { label: "Position", unit: "m" },
  velocityEcef: { label: "ECEF velocity", unit: "m/s" },
  accelerationEcef: { label: "ECEF acceleration", unit: "m/s²" },
};

export function quantityLabel(quantity: PlanQuantity): string {
  return quantities[quantity]?.label ?? quantity;
}

export function quantityUnit(quantity: PlanQuantity): string {
  return quantities[quantity]?.unit ?? "";
}

export function scopeSummary(scope: PlanScope): string {
  if ("event" in scope) return `${scope.event}${scope.side === undefined ? "" : scope.side === "in" ? " · incoming" : " · outgoing"}`;
  if ("section" in scope) return scope.section;
  if ("between" in scope) return `${scope.between[0]} → ${scope.between[1]}`;
  if ("time" in scope) return `At ${trimmed(scope.time)} s`;
  if ("timeRange" in scope) return `${trimmed(scope.timeRange[0])}–${trimmed(scope.timeRange[1])} s`;
  return "Whole trajectory";
}

function valueSummary(value: PlanValue, quantity: PlanQuantity): string {
  const unit = quantityUnit(quantity);
  const suffix = unit === "" ? "" : ` ${unit}`;
  if (typeof value === "number") return `${trimmed(value)}${suffix}`;
  if (Array.isArray(value)) return `[${value.map(trimmed).join(", ")}]${suffix}`;
  if ("point" in value) return value.point;
  const factor = value.factor === undefined || value.factor === 1 ? "" : `${trimmed(value.factor)} × `;
  const offset = value.offset === undefined || value.offset === 0 ? "" : ` ${value.offset > 0 ? "+" : "−"} ${trimmed(Math.abs(value.offset))}${suffix}`;
  return `${factor}${quantityLabel(value.quantity).toLowerCase()} at ${value.event}${value.side === undefined ? "" : ` (${value.side})`}${offset}`;
}

export function ruleSummary(rule: PlanRule): string {
  const kind = rule.kind === "hard" ? "Hard" : rule.kind === "target" ? "Target" : "Objective";
  if ("relation" in rule) {
    const relation = rule.relation;
    return `${kind} · ${relation.type === "followCurve" ? `Follow ${relation.curve}` : `Inside ${relation.region}`}`;
  }
  const quantity = quantityLabel(rule.quantity).toLowerCase();
  if (rule.kind === "target") return `${kind} · ${quantity} ≈ ${valueSummary(rule.value, rule.quantity)}`;
  if (rule.kind === "objective") return `${rule.sense === "maximize" ? "Maximize" : "Minimize"} ${quantity}${rule.reduce === "meanSquare" ? " · mean square" : rule.reduce === "integralSquare" ? " · integral square" : ""}`;
  if (rule.eq !== undefined) return `${kind} · ${quantity} = ${valueSummary(rule.eq, rule.quantity)}`;
  const { min, max } = rule.range ?? {};
  if (min !== undefined && max !== undefined) return `${kind} · ${valueSummary(min, rule.quantity)} ≤ ${quantity} ≤ ${valueSummary(max, rule.quantity)}`;
  if (min !== undefined) return `${kind} · ${quantity} ≥ ${valueSummary(min, rule.quantity)}`;
  if (max !== undefined) return `${kind} · ${quantity} ≤ ${valueSummary(max, rule.quantity)}`;
  return `${kind} · ${quantity}`;
}
