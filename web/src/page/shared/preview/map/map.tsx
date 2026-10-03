"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from "react";
import { fixed, useStore } from "@/core";
import { stateAt, stateWidth, type Track } from "@/model/trajectory";
import { theme } from "@/workbench/theme";
import { Button, Icon, useSize } from "@/page/shared/ui";
import { basemaps } from "@/workbench/basemaps";
import { replaceProblems } from "@/workbench/feedback";
import { styleKey, styleOf } from "./style";
import { BasemapPopover } from "./basemap-popover";
import { mercX, mercY, metresPerPixel, PlanCamera, project, type Bounds, type Camera, type Pad, type View } from "./camera";
import { hasWebgl2, LibreCamera, libreCamera } from "./libre";
import { Overlay } from "./overlay";
import { EditingOverlay, type MapEditing, type MapPoint } from "./editing";
import type { Scene } from "@/workbench/preview";

type Fit = { bounds: Bounds; pad: Pad };

const world = { x: mercX(0), y: mercY(0), zoom: 0 };

function Hud({ scene }: { scene: Scene }) {
  if (scene.track === null) return null;
  const s = stateAt(scene.track, scene.cursor);
  if (s === null) return null;
  const course = Number.isNaN(s.course) ? "—" : `${Math.round(s.course)}°`;
  return (
    <div aria-live="off" className="flex max-w-full flex-col gap-1 rounded-key bg-[color-mix(in_srgb,var(--face)_94%,transparent)] px-3 py-2 ring-key">
      <span className="flex flex-wrap items-baseline gap-4 whitespace-nowrap text-ink2">
        <span title="3D speed">
          <span className="fn text-d2 font-medium text-ink">{fixed(s.speed, 1)}</span> m/s
        </span>
        <span title="Plan altitude">
          <span className="fn font-medium text-ink">{Math.round(s.alt)}</span> m
        </span>
        <span><span className="text-micro">Course</span> <span className="fn font-medium text-ink">{course}</span></span>
      </span>
      <span className="text-micro leading-4 whitespace-nowrap text-ink2">
        <span className="fn">{`${fixed(Math.abs(s.lat), 6)}°`}</span> {s.lat < 0 ? "S" : "N"} · <span className="fn">{`${fixed(Math.abs(s.lon), 6)}°`}</span> {s.lon < 0 ? "W" : "E"}
      </span>
    </div>
  );
}

function ControlGroup({ children }: { children: ReactNode }) {
  return <div className="flex flex-col overflow-hidden rounded-key bg-[color-mix(in_srgb,var(--face)_94%,transparent)] ring-key [&>button]:rounded-none [&>button+button]:border-t [&>button+button]:border-line">{children}</div>;
}

function Key({ label, pressed, ...props }: ComponentProps<typeof Button> & { label: string; pressed?: boolean }) {
  return (
    <Button
      {...props}
      variant="ghost"
      iconOnly
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={`focus-visible:outline-2 focus-visible:-outline-offset-2 ${pressed ? "focus-visible:outline-on-sel" : "focus-visible:outline-(--focus)"}`}
      style={{ color: pressed ? "var(--on-sel)" : "var(--ink)", background: pressed ? "var(--sel)" : undefined }}
    />
  );
}

function Scale({ camera }: { camera: Camera }) {
  const mpp = metresPerPixel(useSyncExternalStore(camera.onMove, camera.view));
  const target = mpp * 110;
  const p = 10 ** Math.floor(Math.log10(target));
  const n = [1, 2, 5, 10].map((k) => k * p).findLast((x) => x <= target) ?? p;
  return (
    <div className="flex flex-col font-mono text-micro leading-4 text-ink">
      <span>{n >= 1000 ? `${n / 1000} km` : `${n} m`}</span>
      <span className="h-1.5 border border-t-0 border-ink" style={{ width: Math.round(n / mpp), background: "linear-gradient(var(--ink),var(--ink)) 50% 100%/1px 4px no-repeat" }} />
    </div>
  );
}

function boundsOf(track: Track | null, points: MapPoint[], minimumMetres: number): Bounds {
  let [x0, y0, x1, y1] = [1, 1, 0, 0];
  for (let i = 0; track !== null && i < track.states.length; i += stateWidth) {
    const x = mercX(track.states[i + 2] ?? 0);
    const y = mercY(track.states[i + 1] ?? 0);
    [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  }
  for (const point of points) {
    const x = mercX(point.lon);
    const y = mercY(point.lat);
    [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  }
  const minimum = minimumMetres / 40_075_016;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return x1 - x0 < minimum && y1 - y0 < minimum ? [cx - minimum / 2, cy - minimum / 3, cx + minimum / 2, cy + minimum / 3] : [x0, y0, x1, y1];
}

function useCamera(host: HTMLDivElement | null, start: Pick<View, "x" | "y" | "zoom">): Camera | null {
  const [camera, setCamera] = useState<Camera | null>(null);
  const owner = useId();
  useEffect(() => {
    if (host === null) return;
    let made: Camera | null = null;
    let cancelled = false;
    const install = (camera: Camera) => {
      if (cancelled) {
        camera.destroy();
        return;
      }
      made = camera;
      setCamera(camera);
    };

    if (hasWebgl2()) {
      const { list, labels } = basemaps.get();
      const mode = theme.get().theme;
      void libreCamera(host, start, styleKey(list, mode, labels), styleOf(list, mode, labels)).then(install, (error) => {
        if (cancelled) return;
        install(new PlanCamera(host, start));
        replaceProblems(owner, [{
          id: `map:${owner}:initialization`, level: "warning", scope: "Map", title: "Basemap unavailable",
          message: `Trajectory available without a basemap. ${error instanceof Error ? error.message : String(error)}`,
        }]);
      });
    } else {
      install(new PlanCamera(host, start));
    }

    return () => {
      cancelled = true;
      made?.destroy();
      setCamera(null);
      replaceProblems(owner, []);
    };
  }, [host, start, owner]);
  return camera;
}

type MapProps = {
  viewKey: string;
  scene: Scene;
  label: string;
} & (
  | { variant?: "workspace"; editing?: MapEditing; follow?: { name: string; active: boolean; change(active: boolean): void } }
  | { variant: "preview"; editing?: never; follow?: never }
);

export function MapView(props: MapProps) {
  return <MapCanvas key={props.viewKey} {...props} />;
}

function MapCanvas({ scene, label, variant = "workspace", editing, follow }: MapProps) {
  const preview = variant === "preview";
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [section, setSection] = useState<HTMLElement | null>(null);
  const [topContent, setTopContent] = useState<HTMLDivElement | null>(null);
  const { list, loaded, labels } = useStore(basemaps, (s) => s);
  const mode = useStore(theme, (s) => s.theme);
  const camera = useCamera(host, world);
  const size = useSize(section);
  const topHeight = useSize(topContent).height;
  const autoFit = useRef<Fit | "waiting" | "manual">("waiting");
  const dragFrom = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const track = scene.track;
  const geometry = editing?.fitPoints ?? editing?.handles ?? [];
  const hasGeometry = track !== null || geometry.length > 0;
  const stopDragging = () => {
    dragFrom.current = null;
  };

  useEffect(() => {
    if (camera instanceof LibreCamera) camera.restyle(styleKey(list, mode, labels), styleOf(list, mode, labels));
  }, [camera, list, mode, labels]);

  const fitView = (remember = true) => {
    const fit: Fit = hasGeometry ? {
      bounds: boundsOf(track, geometry, preview || editing !== undefined ? 100 : 2400),
      pad: preview
        ? { top: 24 + (topContent?.offsetHeight ?? 46), left: 24, right: 56, bottom: 24 }
        : { top: 64 + (topContent?.offsetHeight ?? 46), left: 84, right: 64, bottom: 64 },
    } : {
      bounds: [0, 0, 1, 1],
      pad: { top: 0, left: 0, right: 0, bottom: 0 },
    };
    autoFit.current = remember ? fit : "waiting";
    camera?.fit(fit.bounds, fit.pad, 18);
  };

  useEffect(() => {
    if (camera === null || size.width <= 0) return;
    const fit = autoFit.current;
    if (fit === "waiting") fitView(hasGeometry);
    else if (fit !== "manual") camera.fit(fit.bounds, fit.pad, 18);
  }, [camera, hasGeometry, size.width, size.height]);

  useEffect(() => {
    if (camera === null || !scene.following || track === null) return;
    const s = stateAt(track, scene.cursor);
    if (s === null) return;
    const v = camera.view();
    const [x, y] = project(v, mercX(s.lon), mercY(s.lat));
    if (x < 28 || y < 28 || x > v.width - 28 || y > v.height - 28) camera.jump({ x: mercX(s.lon), y: mercY(s.lat), zoom: v.zoom });
  }, [camera, scene.following, scene.cursor, track]);

  const bare = !(camera instanceof LibreCamera) || list.length === 0;
  const attribution = bare ? "" : [...new Set(list.map((b) => b.attribution).filter(Boolean))].join(" · ");
  return (
    <section
      ref={setSection}
      aria-label="Map"
      className={`relative min-h-0 min-w-0 overflow-hidden bg-land ${editing?.cursor === "crosshair" ? "cursor-crosshair" : ""}`}
      onPointerDown={(e) => {
        autoFit.current = "manual";
        dragFrom.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
      }}
      onWheel={() => {
        autoFit.current = "manual";
      }}
      onPointerMove={(e) => {
        const from = dragFrom.current;
        if (from === null || from.pointerId !== e.pointerId || e.buttons === 0) return;
        if (Math.abs(e.clientX - from.x) + Math.abs(e.clientY - from.y) > 3 && follow?.active) follow.change(false);
      }}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onLostPointerCapture={stopDragging}
    >
      <div ref={setHost} aria-label={label} className="absolute inset-0" />
      {camera !== null ? <Overlay camera={camera} scene={scene} ghost={editing?.ghost} bare={bare} hudBottom={topHeight > 0 ? 12 + topHeight + 8 : 60} /> : null}
      {camera !== null && editing !== undefined ? <EditingOverlay camera={camera} editing={editing} /> : null}
      <div ref={setTopContent} className="pointer-events-none absolute top-3 right-16 left-3 z-5 flex flex-wrap items-start gap-2">
        <Hud scene={scene} />
        {!preview && list.length === 0 && loaded ? (
          <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-3 rounded-key bg-face py-1 pr-1 pl-3 whitespace-nowrap text-ink2 ring-key">
            <Icon name="layers" size={14} />
            <span>No basemap</span>
            <Button size="sm" icon="plus" popoverTarget="basemap">
              Add basemap…
            </Button>
          </div>
        ) : null}
      </div>
      <div className="absolute top-3 right-3 z-5 flex flex-col gap-2">
        <ControlGroup>
          <Key icon="plus" label="Zoom in" onClick={() => camera?.zoomBy(0.678)} />
          <Key icon="minus" label="Zoom out" onClick={() => camera?.zoomBy(-0.678)} />
        </ControlGroup>
        <ControlGroup>
          <Key icon="fit" label={hasGeometry ? "Fit the track" : "Show the world"} onClick={() => fitView()} />
          {follow === undefined ? null : <Key icon="follow" label={`Follow ${follow.name}`} pressed={follow.active} onClick={() => follow.change(!follow.active)} />}
        </ControlGroup>
        {preview ? null : <ControlGroup>
          <Key id="basemap-button" icon="layers" label="Basemap" popoverTarget="basemap" />
        </ControlGroup>}
      </div>
      {preview ? null : <BasemapPopover />}
      <div className="pointer-events-none absolute right-3 bottom-2 left-3 z-4 flex items-end gap-3 text-micro leading-4 text-ink2">
        {camera !== null ? <Scale camera={camera} /> : null}
        {attribution !== "" ? <span className="ml-auto rounded-key bg-[color-mix(in_srgb,var(--face)_80%,transparent)] px-1">{attribution}</span> : null}
      </div>
    </section>
  );
}
