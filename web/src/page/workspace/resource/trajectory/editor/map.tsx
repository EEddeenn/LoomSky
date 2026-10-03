"use client";

import { useRef } from "react";
import { directionPoint, distanceOf, eventCourse, eventPosition, freshPlanId, pointsOf, vector, type GeometryPosition, type Plan, type PlanPosition } from "@/model/trajectory";
import type { PreviewFrame } from "@/model/preview";
import { PreviewMap } from "@/page/shared/preview/scene";
import type { MapEditing, MapViewport } from "@/page/shared/preview/map";
import { Button } from "@/page/shared/ui";
import type { TrajectoryDoc } from "@/workbench/documents/trajectory";
import { useGeometryPreview, type EditOutcome, type Selection, type TrajectorySession } from "@/workbench/documents/trajectory/editing";
import { setView } from "@/workbench/navigation";
import type { PreviewSession } from "@/workbench/preview";

type Control = { kind: "point" | "radius" | "event" | "direction"; id: string; position: PlanPosition };
type SessionState = ReturnType<TrajectorySession["get"]>;

function mapPosition(position: GeometryPosition) {
  return { lat: position.latitude, lon: position.longitude };
}

export function TrajectoryMap({ doc, plan, frame, previewSession, viewport, session, state, visible, interactive, onOutcome }: {
  doc: TrajectoryDoc;
  plan: Plan | null;
  frame: PreviewFrame;
  previewSession: PreviewSession;
  viewport: MapViewport;
  session: TrajectorySession;
  state: SessionState;
  visible: boolean;
  interactive: boolean;
  onOutcome(outcome: EditOutcome): boolean;
}) {
  const track = frame.track;
  const current = doc.view?.currentShape ?? null;
  const previous = doc.view?.shape ?? null;
  const geometry = useGeometryPreview(doc.id, plan, visible);
  const { curveType, regionType } = state;
  const draft = session.drawing;
  const drag = useRef<{ token: symbol; control: Control; position: PlanPosition } | null>(null);
  const { selected, tool, dragMode } = state;
  const gesture = state.edit.kind === "gesture" ? state.edit : null;
  const activeDrag = drag.current?.token === gesture?.token ? drag.current : null;
  const modeLabel = dragMode === "hard" ? "requirement" : dragMode === "initial" ? "initial guess" : "target";

  const createGeometry = (positions: readonly PlanPosition[], kind: "bezier" | "polyline" | "circle" | "polygon") => {
    if (plan === null) return;
    if (!onOutcome(session.execute({ type: "draw-geometry", kind, positions: [...positions] }))) return;
    session.clearDrawing();
    session.setTool("select");
    session.showInspector(true);
  };
  const finishDrawing = () => {
    if (tool === "curve" && curveType === "polyline" && draft.length >= 2) createGeometry(draft, "polyline");
    if (tool === "region" && regionType === "polygon" && draft.length >= 3) createGeometry(draft, "polygon");
  };
  const handles: MapEditing["handles"] = [];
  const paths: NonNullable<MapEditing["paths"]> = [];
  const controls = new Map<string, Control>();
  const selections = new Map<string, Selection>();
  const handle = (control: Control, label: string, selected: boolean, kind: "point" | "handle" | "end" = "point", text?: string) => {
    const id = `${control.kind}:${encodeURIComponent(control.id)}`;
    controls.set(id, control);
    selections.set(id, { kind: control.kind === "radius" ? "region" : control.kind === "direction" ? "event" : control.kind, id: control.id });
    const position = activeDrag?.control.kind === control.kind && activeDrag.control.id === control.id ? activeDrag.position : control.position;
    handles.push({ id, ...mapPosition(position), label, selected, kind, text, lockedLabel: control.kind === "point" ? "Move geometry point" : control.kind === "radius" ? "Resize region" : `Set ${control.kind === "event" ? "position" : "direction"} ${modeLabel}` });
  };
  if (plan !== null) {
    const activeCurve = selected?.kind === "curve" ? plan.geometry.curves?.find((curve) => curve.id === selected.id) : undefined;
    const activeRegion = selected?.kind === "region" ? plan.geometry.regions?.find((region) => region.id === selected.id) : undefined;
    const activePoints = new Set(activeCurve?.points ?? (activeRegion?.type === "circle" ? [activeRegion.center] : activeRegion?.points ?? []));
    const supportPoints = new Set([
      ...(plan.geometry.curves ?? []).flatMap((curve) => curve.points),
      ...(plan.geometry.regions ?? []).flatMap((region) => region.type === "circle" ? [region.center] : region.points),
    ]);
    const rulePoints = new Set<string>();
    for (const rule of plan.rules) {
      if (!("quantity" in rule)) continue;
      const values = rule.kind === "hard" ? [rule.eq, rule.range?.min, rule.range?.max] : rule.kind === "target" ? [rule.value] : [];
      for (const value of values) if (typeof value === "object" && !Array.isArray(value) && "point" in value) rulePoints.add(value.point);
    }
    for (const region of plan.geometry.regions ?? []) {
      const id = `region:${encodeURIComponent(region.id)}`;
      selections.set(id, { kind: "region", id: region.id });
      paths.push({ id, points: geometry?.regions.find((path) => path.id === region.id)?.positions.map(mapPosition) ?? [], kind: "region", closed: true, selected: selected?.kind === "region" && selected.id === region.id, interactive: interactive && tool === "select", label: `Region ${region.id}` });
      if (activeRegion?.id === region.id && region.type === "circle") {
        const center = plan.geometry.points.find((point) => point.id === region.center);
        const resolved = geometry?.regions.find((path) => path.id === region.id)?.radiusPoint;
        if (center !== undefined && resolved !== null && resolved !== undefined) {
          const edge = mapPosition(resolved);
          handle({ kind: "radius", id: region.id, position: { latitude: edge.lat, longitude: edge.lon, altitude: center.position.altitude } }, `${region.id} radius`, true, "handle");
          paths.push({ id: `${id}:radius`, points: [mapPosition(center.position), edge], kind: "connector" });
        }
      }
    }
    for (const curve of plan.geometry.curves ?? []) {
      const id = `curve:${encodeURIComponent(curve.id)}`;
      selections.set(id, { kind: "curve", id: curve.id });
      paths.push({ id, points: geometry?.curves.find((path) => path.id === curve.id)?.positions.map(mapPosition) ?? [], kind: "guide", selected: activeCurve?.id === curve.id, interactive: interactive && tool === "select", label: `Guide curve ${curve.id}` });
      if (activeCurve?.id === curve.id && curve.type === "bezier") {
        paths.push({ id: `${id}:controls`, points: curve.points.flatMap((id) => { const point = plan.geometry.points.find((point) => point.id === id); return point === undefined ? [] : [mapPosition(point.position)]; }), kind: "connector" });
      }
    }
    for (const [index, point] of plan.geometry.points.entries()) {
      const active = selected?.kind === "point" && selected.id === point.id || activePoints.has(point.id);
      if (geometry !== null && supportPoints.has(point.id) && !rulePoints.has(point.id) && !active) continue;
      const controlIndex = activeCurve?.type === "bezier" ? activeCurve.points.indexOf(point.id) : -1;
      handle({ kind: "point", id: point.id, position: point.position }, `Point ${point.id}`, active, controlIndex !== undefined && controlIndex >= 0 && controlIndex % 3 !== 0 ? "handle" : "point", String(index + 1));
    }
    const sectionTrack = frame.track;
    for (const section of sectionTrack?.inspection?.sections ?? []) {
      const id = `section:${encodeURIComponent(section.id)}`;
      selections.set(id, { kind: "section", id: section.id });
      paths.push({ id, points: pointsOf(sectionTrack, section.start, section.end), kind: selected?.kind === "section" && selected.id === section.id ? "selection" : "route", interactive: interactive && tool === "select", label: `Section ${section.id}` });
    }
    const directionLength = Math.max(25, Math.min(250, distanceOf(track) * 0.15));
    for (const event of plan.events) {
      const active = selected?.kind === "event" && selected.id === event.id;
      if (!active && tool !== "direction") continue;
      const position = eventPosition(plan, event.id, track);
      if (position === null) continue;
      handle({ kind: "event", id: event.id, position }, `Event ${event.id}`, active, "end");
      if (!active) continue;
      const tip = directionPoint(mapPosition(position), eventCourse(plan, event.id, track), directionLength);
      handle({ kind: "direction", id: event.id, position: { latitude: tip.lat, longitude: tip.lon, altitude: position.altitude } }, `${event.id} direction`, true, "handle");
      paths.push({ id: `direction-line:${event.id}`, points: [mapPosition(position), activeDrag?.control.kind === "direction" && activeDrag.control.id === event.id ? mapPosition(activeDrag.position) : tip], kind: "connector" });
    }
  }
  if (interactive && draft.length > 0) {
    paths.push({ id: "drawing", points: draft.map(mapPosition), kind: tool === "region" ? "region" : "guide", closed: tool === "region" && regionType === "polygon" && draft.length >= 3 });
    for (const [index, position] of draft.entries()) handles.push({ id: `drawing:${index}`, ...mapPosition(position), kind: "handle", label: `Draft point ${index + 1}`, selected: true });
  }

  const move = (token: symbol, lat: number, lon: number) => {
    const current = drag.current;
    if (current?.token !== token || !session.owns(token) || plan === null) return false;
    const control = current.control;
    const position = { latitude: lat, longitude: lon, altitude: control.position.altitude };
    drag.current = { token, control, position };
    if (control.kind === "point") return onOutcome(session.previewCommand(token, { type: "move-point", id: control.id, position: { latitude: lat, longitude: lon } }));
    if (control.kind === "event") return onOutcome(session.previewPosition(token, { event: control.id }, position));
    if (control.kind === "direction") {
      const origin = eventPosition(plan, control.id, gesture?.baseline.track ?? track);
      return origin !== null && onOutcome(session.previewTarget(token, { event: control.id }, "course", vector(mapPosition(origin), { lat, lon }).course));
    }
    const region = plan.geometry.regions?.find((item) => item.id === control.id);
    if (region?.type !== "circle") return false;
    const center = plan.geometry.points.find((point) => point.id === region.center);
    return center !== undefined && onOutcome(session.previewCommand(token, { type: "replace-region", id: region.id, region: { ...region, radius: Math.max(0.01, vector(mapPosition(center.position), { lat, lon }).length) } }));
  };
  const select = (id: string) => {
    if (!interactive || id.startsWith("drawing:")) return;
    const selection = selections.get(id);
    if (selection !== undefined) session.select(selection);
  };
  const editing: MapEditing = {
    handles,
    gesture: gesture?.token ?? null,
    fitPoints: [...(plan?.geometry.points ?? []).map((point) => mapPosition(point.position)), ...paths.flatMap((path) => path.points), ...handles],
    paths,
    ghost: gesture === null ? current === null ? previous : null : gesture.baseline.track,
    cursor: interactive && tool !== "select" ? "crosshair" : "default",
    onSelect: select,
    onMapClick: (lat, lon) => {
      if (!interactive || plan === null) return;
      const altitude = selected?.kind === "point" ? plan.geometry.points.find((point) => point.id === selected.id)?.position.altitude ?? 0 : 0;
      const position = { latitude: lat, longitude: lon, altitude };
      if (tool === "point") {
        const id = freshPlanId(plan, "point");
        onOutcome(session.execute({ type: "add-point", point: { id, position } }));
      } else if (tool === "curve" && curveType === "bezier" && draft[0] !== undefined) {
        createGeometry([draft[0], position], "bezier");
      } else if (tool === "region" && regionType === "circle" && draft[0] !== undefined) createGeometry([draft[0], position], "circle");
      else if (tool === "curve" || tool === "region") session.appendDrawing(position);
      else if (tool === "direction" && selected?.kind === "event") {
        const origin = eventPosition(plan, selected.id, track);
        if (origin !== null) onOutcome(session.execute({ type: "target", scope: { event: selected.id }, quantity: "course", value: vector(mapPosition(origin), { lat, lon }).course }, "Set event direction"));
      } else if (tool === "select") session.select(null);
    },
    onGestureStart: (id) => {
      const control = controls.get(id);
      if (!interactive || control === undefined || (tool !== "select" && tool !== "direction")) return null;
      const label = control.kind === "point" ? "Move geometry point" : control.kind === "radius" ? "Resize region" : `Set event ${control.kind === "event" ? "position" : "direction"} ${modeLabel}`;
      const begun = session.begin(label);
      if (!onOutcome(begun) || !begun.ok) return null;
      const edit = session.get().edit;
      const position = edit.kind !== "gesture" ? control.position : control.kind === "point"
        ? edit.baseline.source.geometry.points.find((point) => point.id === control.id)?.position ?? control.position
        : control.kind === "event" ? eventPosition(edit.baseline.source, control.id, edit.baseline.track) ?? control.position : control.position;
      drag.current = { token: begun.token, control: { ...control, position }, position };
      return begun.token;
    },
    onGestureMove: move,
    onGestureEnd: (token, lat, lon) => {
      if (move(token, lat, lon)) onOutcome(session.commit(token));
      else session.cancel(token);
      if (drag.current?.token === token) drag.current = null;
    },
    onGestureCancel: (token) => { if (drag.current?.token === token) drag.current = null; session.cancel(token); },
    onDelete: (id) => { if (!interactive || !selections.has(id)) return; select(id); onOutcome(session.removeSelected()); },
  };
  const drawing = interactive && tool !== "select";
  const canFinish = tool === "curve" && curveType === "polyline" && draft.length >= 2 || tool === "region" && regionType === "polygon" && draft.length >= 3;
  return <div className="contents" onKeyDown={(event) => {
    if (!interactive || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || draft.length === 0) return;
    if (document.querySelector("dialog[open], :popover-open") !== null) return;
    if (event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.closest("input,textarea,select,button,[role='button'],[popover],dialog") !== null)) return;
    if (event.key === "Enter" && canFinish) {
      event.preventDefault();
      event.stopPropagation();
      finishDrawing();
    } else if (event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      session.popDrawing();
    }
  }}>
    <PreviewMap frame={frame} session={previewSession} viewport={viewport} editing={editing} />
    {plan === null ? <div className="absolute right-3 bottom-9 left-3 z-20 rounded-key bg-face px-3 py-2 text-small ring-key">Fix the trajectory structure to edit geometry. <button type="button" className="underline underline-offset-3" onClick={() => setView("json")}>Open JSON</button></div> : drawing && gesture === null ? (
      <div className="absolute right-3 bottom-9 left-3 z-20 flex flex-wrap items-center gap-2 rounded-key bg-face px-3 py-2 text-small ring-key">
        {tool === "curve" ? <select aria-label="Guide curve type" className="rounded-key bg-panel px-2 py-1 ring-key" value={curveType} onChange={(event) => session.setCurveType(event.target.value === "polyline" ? "polyline" : "bezier")}><option value="bezier">Bézier curve</option><option value="polyline">Polyline</option></select> : null}
        {tool === "region" ? <select aria-label="Region type" className="rounded-key bg-panel px-2 py-1 ring-key" value={regionType} onChange={(event) => session.setRegionType(event.target.value === "polygon" ? "polygon" : "circle")}><option value="circle">Circle</option><option value="polygon">Convex polygon</option></select> : null}
        <span>{tool === "point" ? "Click to add a point" : tool === "direction" ? selected?.kind === "event" ? "Click or drag the direction handle" : "Select an event to set its direction" : tool === "curve" ? curveType === "bezier" ? draft.length === 0 ? "Click the start of the guide curve" : "Click the end; drag its control points to shape it" : "Click each vertex, then finish" : regionType === "circle" ? draft.length === 0 ? "Click the region center" : "Click to set the radius" : "Click the corners in boundary order, then finish"}</span>
        {canFinish ? <Button size="sm" onClick={finishDrawing}>Finish</Button> : null}
        {draft.length > 0 ? <Button size="sm" variant="ghost" onClick={() => session.popDrawing()}>Remove last</Button> : null}
        <span className="ml-auto text-micro text-ink3">Esc cancels</span>
      </div>
    ) : null}
    {gesture === null && current === null && previous !== null ? <div className="pointer-events-none absolute top-3 right-16 z-10 rounded-key bg-face px-2 py-1 text-micro text-ink3 ring-key">Previous solution</div> : gesture === null && current !== null && !doc.view?.ready ? <div className="pointer-events-none absolute top-3 right-16 z-10 rounded-key bg-face px-2 py-1 text-micro text-fault ring-key">Current candidate · not verified</div> : null}
  </div>;
}
