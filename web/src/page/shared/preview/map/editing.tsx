"use client";

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Track } from "@/model/trajectory";
import { latOf, lonOf, mercX, mercY, project, unproject, type Camera } from "./camera";

export type MapPoint = { lat: number; lon: number };
type MapHandle = MapPoint & {
  id: string;
  kind?: "point" | "handle" | "end";
  label: string;
  text?: string;
  selected?: boolean;
  lockedLabel?: string;
};
type MapPath = {
  id: string;
  points: MapPoint[];
  kind?: "route" | "connector" | "selection" | "guide" | "region";
  interactive?: boolean;
  label?: string;
  closed?: boolean;
  selected?: boolean;
};
export type MapEditing = {
  handles: MapHandle[];
  gesture: symbol | null;
  fitPoints?: MapPoint[];
  paths?: MapPath[];
  ghost?: Track | null;
  cursor?: "crosshair" | "default";
  onSelect(id: string): void;
  onMapClick(lat: number, lon: number): void;
  onGestureStart(id: string): symbol | null;
  onGestureMove(token: symbol, lat: number, lon: number): void;
  onGestureEnd(token: symbol, lat: number, lon: number): void;
  onGestureCancel(token: symbol): void;
  onDelete?(id: string): void;
};

export function EditingOverlay({ camera, editing }: { camera: Camera; editing: MapEditing }) {
  const view = useSyncExternalStore(camera.onMove, camera.view);
  const latest = useRef(editing);
  latest.current = editing;
  const element = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: string;
    token: symbol;
    move(event: PointerEvent): void;
    finish(event?: PointerEvent, commit?: boolean): void;
  } | null>(null);

  useLayoutEffect(() => () => drag.current?.finish(), [camera]);

  useEffect(() => {
    if (drag.current !== null && (drag.current.token !== editing.gesture || !editing.handles.some((handle) => handle.id === drag.current?.id))) drag.current.finish();
  }, [editing.gesture, editing.handles]);

  useEffect(() => camera.onClick((mx, my) => latest.current.onMapClick(latOf(my), lonOf(mx))), [camera]);

  const begin = (event: ReactPointerEvent<HTMLButtonElement>, handle: MapHandle) => {
    if (event.button !== 0 || drag.current !== null) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    target.focus({ preventScroll: true });
    latest.current.onSelect(handle.id);
    const token = latest.current.onGestureStart(handle.id);
    if (token === null) return;
    const bounds = element.current?.getBoundingClientRect();
    if (bounds === undefined) {
      latest.current.onGestureCancel(token);
      return;
    }
    const pointerId = event.pointerId;
    const fromX = event.clientX;
    const fromY = event.clientY;
    let moved = false;
    const [x, y] = project(camera.view(), mercX(handle.lon), mercY(handle.lat));
    const offsetX = x - (event.clientX - bounds.left);
    const offsetY = y - (event.clientY - bounds.top);
    const distance = (e: PointerEvent) => Math.hypot(e.clientX - fromX, e.clientY - fromY);
    const position = (e: PointerEvent): [number, number] => {
      const rect = element.current?.getBoundingClientRect() ?? bounds;
      const [mx, my] = unproject(camera.view(), e.clientX - rect.left + offsetX, e.clientY - rect.top + offsetY);
      return [latOf(my), lonOf(mx)];
    };
    drag.current = {
      id: handle.id,
      token,
      move(e) {
        if (e.pointerId !== pointerId || !moved && distance(e) < 3) return;
        moved = true;
        latest.current.onGestureMove(token, ...position(e));
      },
      finish(e, commit = false) {
        if (drag.current?.token !== token || e !== undefined && e.pointerId !== pointerId) return;
        drag.current = null;
        camera.setPanning(true);
        if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
        if (commit && e !== undefined && (moved || distance(e) >= 3)) latest.current.onGestureEnd(token, ...position(e));
        else latest.current.onGestureCancel(token);
      },
    };
    camera.setPanning(false);
    try {
      target.setPointerCapture(pointerId);
    } catch {
      drag.current?.finish();
    }
  };

  const actionKey = (event: ReactKeyboardEvent, id: string) => {
    const action = event.key === "Delete" || event.key === "Backspace" ? editing.onDelete
      : event.key === "Enter" || event.key === " " ? editing.onSelect : undefined;
    if (action === undefined) return false;
    event.preventDefault();
    event.stopPropagation();
    action(id);
    return true;
  };

  const key = (event: ReactKeyboardEvent, handle: MapHandle) => {
    if (actionKey(event, handle.id)) return;
    const direction = event.key === "ArrowLeft" ? [-1, 0]
      : event.key === "ArrowRight" ? [1, 0]
      : event.key === "ArrowUp" ? [0, -1]
      : event.key === "ArrowDown" ? [0, 1]
      : null;
    if (direction === null || drag.current !== null) return;
    event.preventDefault();
    event.stopPropagation();
    editing.onSelect(handle.id);
    const token = editing.onGestureStart(handle.id);
    if (token === null) return;
    const [x, y] = project(camera.view(), mercX(handle.lon), mercY(handle.lat));
    const step = event.shiftKey ? 10 : 1;
    const [mx, my] = unproject(camera.view(), x + (direction[0] ?? 0) * step, y + (direction[1] ?? 0) * step);
    editing.onGestureMove(token, latOf(my), lonOf(mx));
    editing.onGestureEnd(token, latOf(my), lonOf(mx));
  };

  return (
    <div
      ref={element}
      className="pointer-events-none absolute inset-0 z-4"
      aria-label="Trajectory map controls"
      onPointerMove={(event) => drag.current?.move(event.nativeEvent)}
      onPointerUp={(event) => drag.current?.finish(event.nativeEvent, true)}
      onPointerCancel={(event) => drag.current?.finish(event.nativeEvent)}
      onLostPointerCapture={(event) => drag.current?.finish(event.nativeEvent)}
    >
      <svg className="absolute inset-0 h-full w-full">
        {(editing.paths ?? []).map((path) => {
          const d = path.points
            .map((point, index) => {
              const [x, y] = project(view, mercX(point.lon), mercY(point.lat));
              return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
            })
            .join("") + (path.closed ? "Z" : "");
          return (
            <g key={path.id}>
              <path className={`ma-path ma-${path.kind ?? "route"}${path.selected ? " is-selected" : ""}`} d={d} aria-hidden="true" />
              {path.interactive ? (
                <path
                  className={`ma-path-hit${path.closed ? " ma-area-hit" : ""}`}
                  d={d}
                  role="button"
                  tabIndex={0}
                  aria-label={path.label ?? "Select route segment"}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    editing.onSelect(path.id);
                  }}
                  onKeyDown={(event) => actionKey(event, path.id)}
                />
              ) : null}
            </g>
          );
        })}
      </svg>
      {editing.handles.map((handle) => {
        const [x, y] = project(view, mercX(handle.lon), mercY(handle.lat));
        return (
          <button
            key={handle.id}
            type="button"
            className={`ma-handle ma-kind-${handle.kind ?? "point"}${handle.selected ? " is-selected" : ""}`}
            style={{ left: x, top: y }}
            aria-label={handle.label}
            aria-pressed={handle.selected === true}
            title={`${handle.label}${handle.lockedLabel ? ` · ${handle.lockedLabel}` : ""}`}
            onPointerDown={(event) => begin(event, handle)}
            onClick={(event) => { event.stopPropagation(); if (event.detail === 0) editing.onSelect(handle.id); }}
            onKeyDown={(event) => key(event, handle)}
          >
            <span className="ma-dot" aria-hidden="true">{handle.text}</span>
            {handle.selected && handle.lockedLabel ? (
              <span
                className="ma-lock"
                style={{
                  left: x < 145 ? 14 : undefined,
                  right: x > view.width - 145 ? 14 : undefined,
                  ...(y > view.height - 80 ? { top: "auto", bottom: 27 } : {}),
                }}
                aria-hidden="true"
              >
                {handle.lockedLabel}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
