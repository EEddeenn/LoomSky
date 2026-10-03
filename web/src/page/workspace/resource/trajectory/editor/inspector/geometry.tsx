import { diagnosticsAt, pathKey } from "@/model/document";
import type { Plan, PlanCurve, PlanRegion } from "@/model/trajectory";
import { Messages, NumberField } from "@/page/shared/documents/editor";
import { Button } from "@/page/shared/ui";
import type { TrajectoryDoc } from "@/workbench/documents/trajectory";
import { InspectorDisclosure, InspectorSection, InspectorSelect, PositionFields, type InspectorPath } from "./fields";

function PointReferences({ doc, plan, path, points, bezier = false, minimum, onChange }: {
  doc: TrajectoryDoc;
  plan: Plan;
  path: InspectorPath;
  points: string[];
  bezier?: boolean;
  minimum: number;
  onChange(points: string[]): void;
}) {
  const options = plan.geometry.points.map((point) => ({ value: point.id, label: point.id }));
  const shift = (index: number, direction: -1 | 1) => {
    const next = [...points];
    const current = next[index];
    const other = next[index + direction];
    if (current === undefined || other === undefined) return;
    next[index] = other;
    next[index + direction] = current;
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-2" data-path={pathKey(doc.kind, path)}>
      {points.map((point, index) => (
        <div key={index} className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-end gap-1">
            <div className="min-w-0 flex-1">
              <InspectorSelect
                doc={doc}
                path={[...path, index]}
                label={bezier ? `${index % 3 === 0 ? "Anchor" : "Control point"} ${index + 1}` : `Point ${index + 1}`}
                value={point}
                options={options}
                diagnostics={false}
                onChange={(value) => onChange(points.map((item, i) => i === index ? value : item))}
              />
            </div>
            <div className="flex h-8 shrink-0 items-center gap-0.5">
              <Button size="xs" variant="ghost" iconOnly disabled={index === 0} aria-label={`Move point ${index + 1} earlier`} title="Move earlier" onClick={() => shift(index, -1)}>↑</Button>
              <Button size="xs" variant="ghost" iconOnly disabled={index === points.length - 1} aria-label={`Move point ${index + 1} later`} title="Move later" onClick={() => shift(index, 1)}>↓</Button>
              {bezier ? null : <Button size="xs" variant="ghost" icon="trash" iconOnly aria-label={`Remove point ${index + 1}`} title="Remove reference" disabled={points.length <= minimum} onClick={() => onChange(points.filter((_, i) => i !== index))} />}
            </div>
          </div>
          <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, [...path, index], "self")} />
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          size="xs"
          disabled={options.length === 0}
          onClick={() => {
            const next = options.find((option) => !points.includes(option.value))?.value ?? points.at(-1) ?? options[0]?.value;
            if (next !== undefined) onChange([...points, ...(bezier ? [next, next, next] : [next])]);
          }}
        >{bezier ? "Add Bézier span" : "Add point reference"}</Button>
        {bezier ? <Button size="xs" variant="ghost" disabled={points.length <= 4} onClick={() => onChange(points.slice(0, -3))}>Remove last span</Button> : null}
      </div>
      <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, path, "self")} />
    </div>
  );
}

export function PointInspector({ doc, index }: { doc: TrajectoryDoc; index: number }) {
  const path = ["geometry", "points", index];
  return (
    <InspectorSection title="Position">
      <PositionFields doc={doc} path={[...path, "position"]} />
      <p className="m-0 text-small text-ink3">Moving this point changes all curves, regions, and position rules that reference it.</p>
      <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, path, "self")} />
    </InspectorSection>
  );
}

type GeometryInspectorProps<T> = {
  doc: TrajectoryDoc;
  plan: Plan;
  value: T;
  index: number;
  onReplace(update: (value: T) => T): void;
};

export function CurveInspector({ doc, plan, value: curve, index, onReplace }: GeometryInspectorProps<PlanCurve>) {
  const path = ["geometry", "curves", index];
  return (
    <>
      <InspectorSection title={curve.type === "bezier" ? "Anchors and control points" : "Vertices"}>
        <PointReferences doc={doc} plan={plan} path={[...path, "points"]} points={curve.points} bezier={curve.type === "bezier"} minimum={2} onChange={(points) => onReplace((current) => ({ ...current, points }))} />
      </InspectorSection>
      <InspectorDisclosure title="Curve type" summary={curve.type === "bezier" ? "Cubic Bézier" : "Polyline"}>
        <InspectorSelect
          doc={doc}
          path={[...path, "type"]}
          label="Curve type"
          options={[{ value: "bezier", label: "Cubic Bézier" }, { value: "polyline", label: "Polyline" }]}
          onChange={(type) => {
            if (type !== "bezier" && type !== "polyline") return;
            onReplace((current) => {
              const points = [...current.points];
              const last = points.at(-1) ?? plan.geometry.points[0]?.id;
              if (last === undefined) return current;
              const count = type === "bezier" ? Math.max(4, Math.ceil((points.length - 1) / 3) * 3 + 1) : Math.max(2, points.length);
              while (points.length < count) points.push(last);
              return { ...current, type, points };
            });
          }}
        />
        <p className="m-0 text-small text-ink3">{curve.type === "bezier" ? "Each cubic ECEF span has two anchors and two control points. Adjacent spans share anchors." : "Straight segments join points in order."}</p>
      </InspectorDisclosure>
      <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, path, "self")} />
    </>
  );
}

export function RegionInspector({ doc, plan, value: region, index, onReplace }: GeometryInspectorProps<PlanRegion>) {
  const path = ["geometry", "regions", index];
  return (
    <>
      {region.type === "circle" ? (
        <>
          <InspectorSelect doc={doc} path={[...path, "center"]} label="Center point" options={plan.geometry.points.map((point) => ({ value: point.id, label: point.id }))} />
          <NumberField doc={doc.editor} path={[...path, "radius"]} label="Radius" unit="m" />
        </>
      ) : (
        <>
          <p className="m-0 text-small text-ink3">List boundary vertices in order; the region must be convex.</p>
          <PointReferences doc={doc} plan={plan} path={[...path, "points"]} points={region.points} minimum={3} onChange={(points) => onReplace((current) => current.type === "polygon" ? { ...current, points } : current)} />
        </>
      )}
      <InspectorDisclosure title="Region shape" summary={region.type === "circle" ? "Circle" : "Convex polygon"}>
        <InspectorSelect
          doc={doc}
          path={[...path, "type"]}
          label="Region shape"
          options={[
            ...(plan.geometry.points.length > 0 ? [{ value: "circle", label: "Circle" }] : []),
            ...(plan.geometry.points.length >= 3 ? [{ value: "polygon", label: "Convex polygon" }] : []),
          ]}
          onChange={(type) => {
            if (type === "circle") {
              onReplace((current) => {
                const center = current.type === "polygon" ? current.points[0] ?? plan.geometry.points[0]?.id : current.center;
                return center === undefined ? current : { id: current.id, type, center, radius: current.type === "circle" ? current.radius : 100 };
              });
            } else if (type === "polygon") {
              onReplace((current) => {
                const points = current.type === "polygon" ? current.points : plan.geometry.points.slice(0, 3).map((point) => point.id);
                return points.length >= 3 ? { id: current.id, type, points } : current;
              });
            }
          }}
        />
      </InspectorDisclosure>
      <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, path, "self")} />
    </>
  );
}
