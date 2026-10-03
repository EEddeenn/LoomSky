import type { Plan, PlanQuantity, PlanRule, PlanScope, PlanValue } from "./source";
import { freshPlanId, type PlanEntity } from "./commands";

type PlanRuleOperator = "eq" | "min" | "max" | "range" | "target" | "objective";

export function isScalarQuantity(quantity: PlanQuantity): boolean {
  return quantity !== "position" && quantity !== "velocityEcef" && quantity !== "accelerationEcef";
}

export function ruleOperator(rule: PlanRule): PlanRuleOperator {
  if (rule.kind === "target" || rule.kind === "objective") return rule.kind;
  if (!("quantity" in rule) || rule.range === undefined) return "eq";
  return rule.range.min === undefined ? "max" : rule.range.max === undefined ? "min" : "range";
}

export function defaultPlanValue(plan: Plan, quantity: PlanQuantity): PlanValue {
  if (quantity === "position") {
    const point = plan.geometry.points[0];
    return point === undefined ? [0, 0, 0] : { point: point.id };
  }
  return isScalarQuantity(quantity) ? 0 : [0, 0, 0];
}

export function quantityRule(plan: Plan, rule: PlanRule, quantity: PlanQuantity, operator: PlanRuleOperator): PlanRule {
  const sameQuantity = "quantity" in rule && rule.quantity === quantity;
  const current = sameQuantity
    ? rule.kind === "target" ? rule.value : rule.kind === "hard" ? rule.eq ?? rule.range?.min ?? rule.range?.max : undefined
    : undefined;
  const value = current ?? defaultPlanValue(plan, quantity);
  const range = sameQuantity && rule.kind === "hard" ? rule.range : undefined;
  const reduce = rule.kind === "objective" ? rule.reduce : undefined;
  const base = { id: rule.id, scope: rule.scope, quantity, scale: rule.scale };
  if (operator === "target") return { ...base, kind: "target", value, weight: "weight" in rule ? rule.weight : undefined };
  if (operator === "objective") return {
    ...base, kind: "objective", weight: "weight" in rule ? rule.weight : undefined,
    reduce: isScalarQuantity(quantity) ? reduce : reduce === undefined || reduce === "value" ? "meanSquare" : reduce,
    sense: rule.kind === "objective" ? rule.sense : undefined,
  };
  if (operator === "min") return { ...base, kind: "hard", range: { min: range?.min ?? value } };
  if (operator === "max") return { ...base, kind: "hard", range: { max: range?.max ?? value } };
  if (operator === "range") return { ...base, kind: "hard", range: { min: range?.min ?? value, max: range?.max ?? value } };
  return { ...base, kind: "hard", eq: value };
}

export function ruleWithScope(rule: PlanRule, scope: PlanScope): PlanRule {
  return rule.kind === "objective" && rule.reduce === "integralSquare" && ("event" in scope || "time" in scope)
    ? { ...rule, scope, reduce: "meanSquare" }
    : { ...rule, scope };
}

export function createPlanRule(plan: Plan, selection: PlanEntity | null): PlanRule | null {
  const id = freshPlanId(plan, "rule");
  if (selection?.kind === "curve") return { id, kind: "hard", scope: { all: true }, relation: { type: "followCurve", curve: selection.id } };
  if (selection?.kind === "region") return { id, kind: "hard", scope: { all: true }, relation: { type: "insideRegion", region: selection.id } };
  if (selection?.kind === "point") {
    const event = plan.events[0];
    return event === undefined ? null : { id, kind: "hard", scope: { event: event.id }, quantity: "position", eq: { point: selection.id } };
  }
  const scope: PlanScope = selection?.kind === "event" ? { event: selection.id } : selection?.kind === "section" ? { section: selection.id } : { all: true };
  return { id, kind: "hard", scope, quantity: "speed3d", range: {} };
}
