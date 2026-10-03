import { diagnosticsAt, pathKey } from "@/model/document";
import { defaultPlanValue, isScalarQuantity, planQuantities, quantityRule, ruleOperator, ruleWithScope, type Plan, type PlanQuantity, type PlanRule, type PlanValue } from "@/model/trajectory";
import { Messages, NumberField } from "@/page/shared/documents/editor";
import type { TrajectoryDoc } from "@/workbench/documents/trajectory";
import { quantityLabel, quantityUnit } from "../summary";
import { InspectorDisclosure, InspectorSection, InspectorSelect, SideSelect, VectorFields, type InspectorPath } from "./fields";
import { ScopeFields } from "./scope";

function ValueFields({ doc, plan, path, quantity, value, onChange }: {
  doc: TrajectoryDoc;
  plan: Plan;
  path: InspectorPath;
  quantity: PlanQuantity;
  value: PlanValue;
  onChange(value: PlanValue): void;
}) {
  const kind = typeof value === "number" ? "number" : Array.isArray(value) ? "vector" : "point" in value ? "point" : "event";
  const unit = quantityUnit(quantity);
  const sources = [
    ...(isScalarQuantity(quantity) ? [{ value: "number", label: "Number" }] : [{ value: "vector", label: "ECEF vector" }]),
    ...(quantity === "position" && plan.geometry.points.length > 0 ? [{ value: "point", label: "Geometry point" }] : []),
    ...(plan.events.length > 0 ? [{ value: "event", label: "Value at another event" }] : []),
  ];
  return (
    <>
      {sources.length === 1 && sources[0]?.value === kind ? null : <InspectorSelect
        doc={doc}
        path={path}
        label="Value source"
        diagnostics={false}
        value={kind}
        options={sources}
        onChange={(next) => {
          if (next === "number") onChange(0);
          else if (next === "vector") onChange([0, 0, 0]);
          else if (next === "point") {
            const point = plan.geometry.points[0];
            if (point !== undefined) onChange({ point: point.id });
          } else if (next === "event") {
            const event = plan.events[0];
            if (event !== undefined) onChange({ event: event.id, quantity });
          }
        }}
      />}
      {typeof value === "number" ? (
        <NumberField doc={doc.editor} path={path} label="Value" unit={unit} />
      ) : Array.isArray(value) ? (
        <VectorFields doc={doc} path={path} unit={unit} />
      ) : "point" in value ? (
        <InspectorSelect doc={doc} path={[...path, "point"]} label="Point" options={plan.geometry.points.map((point) => ({ value: point.id, label: point.id }))} />
      ) : (
        <>
          <InspectorSelect doc={doc} path={[...path, "event"]} label="Reference event" options={plan.events.map((event) => ({ value: event.id, label: event.id }))} />
          <InspectorSelect doc={doc} path={[...path, "quantity"]} label="Reference quantity" options={planQuantities.map((item) => ({ value: item, label: quantityLabel(item) }))} />
          <InspectorDisclosure title="Reference options">
            <SideSelect doc={doc} path={[...path, "side"]} label="Reference side" defaultLabel="Default side" />
            <div className="grid grid-cols-2 gap-3">
              <NumberField doc={doc.editor} path={[...path, "factor"]} label="Factor" unit="" />
              <NumberField doc={doc.editor} path={[...path, "offset"]} label="Offset" unit={unit} />
            </div>
            <p className="m-0 text-small text-ink3">Reference value × factor + offset.{isScalarQuantity(quantity) ? "" : " The offset applies to each component."}</p>
          </InspectorDisclosure>
        </>
      )}
    </>
  );
}

export function RuleInspector({ doc, plan, rule, index, onReplace }: {
  doc: TrajectoryDoc;
  plan: Plan;
  rule: PlanRule;
  index: number;
  onReplace(update: (rule: PlanRule) => PlanRule): void;
}) {
  const path = ["rules", index];
  const operator = ruleOperator(rule);
  const curves = plan.geometry.curves ?? [];
  const regions = plan.geometry.regions ?? [];
  const types = [
    { value: "quantity", label: "Quantity" },
    ...(curves.length > 0 ? [{ value: "followCurve", label: "Follow curve" }] : []),
    ...(regions.length > 0 ? [{ value: "insideRegion", label: "Inside region" }] : []),
  ];
  return (
    <div className="flex min-w-0 flex-col gap-3" data-path={pathKey(doc.kind, path)}>
      {types.length === 1 && "quantity" in rule ? null : <InspectorSelect
        doc={doc}
        path={path}
        label="Rule type"
        diagnostics={false}
        value={"relation" in rule ? rule.relation.type : "quantity"}
        options={types}
        onChange={(type) => {
          if (type === "quantity") onReplace((current) => quantityRule(plan, current, "speed3d", "eq"));
          else if (type === "followCurve") {
            const curve = curves[0];
            if (curve !== undefined) onReplace((current) => ({ id: current.id, kind: "hard", scope: current.scope, relation: { type, curve: curve.id } }));
          } else if (type === "insideRegion") {
            const region = regions[0];
            if (region !== undefined) onReplace((current) => ({ id: current.id, kind: "hard", scope: current.scope, relation: { type, region: region.id } }));
          }
        }}
      />}
      {"quantity" in rule ? (
        <>
          <InspectorSelect
            doc={doc}
            path={[...path, "quantity"]}
            label="Quantity"
            options={planQuantities.map((quantity) => ({ value: quantity, label: quantityLabel(quantity) }))}
            onChange={(next) => {
              const quantity = planQuantities.find((item) => item === next);
              if (quantity === undefined) return;
              onReplace((current) => quantityRule(plan, current, quantity, operator));
            }}
          />
          <InspectorSelect
            doc={doc}
            path={path}
            label="Operator"
            diagnostics={false}
            value={operator}
            options={[
              { value: "eq", label: "= · Exact value" },
              { value: "min", label: "Minimum" },
              { value: "max", label: "Maximum" },
              { value: "range", label: "Range · Lower and upper bounds" },
              { value: "target", label: "Target · Preferred value" },
              { value: "objective", label: "Objective · Minimize or maximize" },
            ]}
            onChange={(next) => {
              if (next === "eq" || next === "min" || next === "max" || next === "range" || next === "target" || next === "objective") onReplace((current) => quantityRule(plan, current, "quantity" in current ? current.quantity : rule.quantity, next));
            }}
          />
          {!isScalarQuantity(rule.quantity) && (operator === "min" || operator === "max" || operator === "range") ? <p className="m-0 text-small text-ink3">Bounds apply to each ECEF component.</p> : null}
          {rule.kind === "hard" && rule.range !== undefined ? (
            (["min", "max"] as const).filter((field) => operator === field || operator === "range").map((field) => (
              <InspectorSection key={field} title={field === "min" ? "Lower bound" : "Upper bound"}>
                <ValueFields doc={doc} plan={plan} path={[...path, "range", field]} quantity={rule.quantity} value={rule.range?.[field] ?? defaultPlanValue(plan, rule.quantity)}
                  onChange={(value) => onReplace((current) => "quantity" in current && current.kind === "hard" && current.range !== undefined ? { ...current, range: { ...current.range, [field]: value } } : current)} />
              </InspectorSection>
            ))
          ) : rule.kind === "objective" ? (
            <InspectorSelect doc={doc} path={[...path, "sense"]} label="Direction" value={rule.sense ?? "minimize"} options={[{ value: "minimize", label: "Minimize" }, { value: "maximize", label: "Maximize" }]} />
          ) : rule.kind === "target" ? (
            <ValueFields doc={doc} plan={plan} path={[...path, "value"]} quantity={rule.quantity} value={rule.value} onChange={(value) => onReplace((current) => "quantity" in current && current.kind === "target" ? { ...current, value } : current)} />
          ) : rule.eq === undefined ? null : (
            <ValueFields doc={doc} plan={plan} path={[...path, "eq"]} quantity={rule.quantity} value={rule.eq} onChange={(eq) => onReplace((current) => "quantity" in current && current.kind === "hard" ? { id: current.id, kind: "hard", scope: current.scope, quantity: current.quantity, scale: current.scale, eq } : current)} />
          )}
        </>
      ) : (
        <>
          <InspectorSelect
            doc={doc}
            path={[...path, "kind"]}
            label="Operator"
            options={[{ value: "hard", label: "= · Required relation" }, { value: "target", label: "Target · Preferred relation" }]}
            onChange={(kind) => {
              if (kind === "hard") onReplace((current) => "relation" in current ? { id: current.id, kind, scope: current.scope, relation: current.relation, scale: current.scale } : current);
              else if (kind === "target") onReplace((current) => "relation" in current ? { ...current, kind } : current);
            }}
          />
          {rule.relation.type === "followCurve" ? (
            <>
              <InspectorSelect doc={doc} path={[...path, "relation", "curve"]} label="Curve" options={curves.map((curve) => ({ value: curve.id, label: curve.id }))} />
              <InspectorDisclosure title="Curve options">
                <div className="grid grid-cols-2 gap-3">
                  <NumberField doc={doc.editor} path={[...path, "relation", "from"]} label="From progress" unit="" />
                  <NumberField doc={doc.editor} path={[...path, "relation", "to"]} label="To progress" unit="" />
                </div>
                <NumberField doc={doc.editor} path={[...path, "relation", "tolerance"]} label="Curve tolerance" unit="m" />
              </InspectorDisclosure>
            </>
          ) : (
            <InspectorSelect doc={doc} path={[...path, "relation", "region"]} label="Region" options={regions.map((region) => ({ value: region.id, label: region.id }))} />
          )}
        </>
      )}
      <div className="flex min-w-0 flex-col gap-3 border-t border-line2 pt-3">
        <ScopeFields doc={doc} plan={plan} path={[...path, "scope"]} scope={rule.scope} onChange={(scope) => onReplace((current) => ruleWithScope(current, scope))} />
      </div>
      <InspectorDisclosure title="Advanced" summary={rule.kind === "hard" ? "Normalization" : "Preference strength"}>
        {rule.kind !== "objective" ? null : <InspectorSelect doc={doc} path={[...path, "reduce"]} label="Reduction" value={rule.reduce ?? "value"} options={[
          ...(isScalarQuantity(rule.quantity) ? [{ value: "value", label: "Value" }] : []),
          { value: "meanSquare", label: "Mean square" },
          ...("event" in rule.scope || "time" in rule.scope ? [] : [{ value: "integralSquare", label: "Integral square" }]),
        ]} />}
        <div className="grid grid-cols-2 gap-3">
          <NumberField doc={doc.editor} path={[...path, "scale"]} label="Scale" unit={"quantity" in rule ? quantityUnit(rule.quantity) : "m"} />
          {rule.kind === "hard" ? null : <NumberField doc={doc.editor} path={[...path, "weight"]} label="Weight" unit="" />}
        </div>
        <p className="m-0 text-small text-ink3">{rule.kind === "hard" ? "Scale normalizes the constraint residual." : "Scale normalizes error. Higher weight gives this preference more influence."}</p>
      </InspectorDisclosure>
      <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, path, "self")} />
    </div>
  );
}
