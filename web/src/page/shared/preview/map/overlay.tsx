"use client";

import { useMemo, useSyncExternalStore } from "react";
import { fixed, type Decimals } from "@/core";
import { headingAt, stateAt, stateWidth, type Track } from "@/model/trajectory";
import { Fig } from "@/page/shared/ui";
import { latOf, lonOf, mercX, mercY, project, unproject, type Camera, type View } from "./camera";
import "./overlay.css";
import type { Marker, Scene } from "@/workbench/preview";

function mercOf(track: Track): Float64Array {
  const n = track.states.length / stateWidth;
  const out = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    out[i * 2] = mercX(track.states[i * stateWidth + 2] ?? 0);
    out[i * 2 + 1] = mercY(track.states[i * stateWidth + 1] ?? 0);
  }
  return out;
}

function pathOf(v: View, merc: Float64Array, track: Track, from = 0, to = Number.POSITIVE_INFINITY): string {
  const n = merc.length / 2;
  let d = "";
  let lx = Number.NaN;
  let ly = Number.NaN;
  const put = (mx: number, my: number, force: boolean) => {
    const [x, y] = project(v, mx, my);
    if (!force && Math.abs(x - lx) < 0.6 && Math.abs(y - ly) < 0.6) return;
    d += `${d === "" ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    lx = x;
    ly = y;
  };
  if (from > 0) {
    const s = stateAt(track, from);
    if (s !== null) put(mercX(s.lon), mercY(s.lat), true);
  }
  for (let i = 0; i < n; i++) {
    const t = track.states[i * stateWidth] ?? 0;
    if (t < from || t > to) continue;
    put(merc[i * 2] ?? 0, merc[i * 2 + 1] ?? 0, false);
  }
  if (Number.isFinite(to)) {
    const s = stateAt(track, to);
    if (s !== null) put(mercX(s.lon), mercY(s.lat), true);
  }
  return d;
}

function ticksOf(v: View, track: Track): { minor: string; major: string } {
  const length = track.duration;
  if (!(length > 60)) return { minor: "", major: "" };
  const step = length > 14_400 ? 300 : 60;
  let minor = "";
  let major = "";
  for (let t = step; t < length - 1e-6; t += step) {
    const s = stateAt(track, t);
    if (s === null) continue;
    const [x, y] = project(v, mercX(s.lon), mercY(s.lat));
    const c = (headingAt(track, t) * Math.PI) / 180;
    if (Number.isNaN(c)) continue;
    const big = Math.round(t) % (step * 5) === 0;
    const l = big ? 6 : 3.5;
    const seg = `M${(x - Math.cos(c) * l).toFixed(1)} ${(y - Math.sin(c) * l).toFixed(1)}L${(x + Math.cos(c) * l).toFixed(1)} ${(y + Math.sin(c) * l).toFixed(1)}`;
    if (big) major += seg;
    else minor += seg;
  }
  return { minor, major };
}

function MarkerShape({ m, x, y, course, width }: { m: Marker; x: number; y: number; course: number; width: number }) {
  const radius = m.kind === "onair" ? 7.5 : m.kind === "cursor" ? 6.5 : m.kind === "ghost" ? 9 : 7;
  const labelWidth = Math.round((m.label?.length ?? 0) * 7.1 + 16);
  const labelX = x > width - (labelWidth + 40) ? -13 - labelWidth : 13;
  return (
    <g className={`mk mk-${m.kind}`} transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`}>
      {m.kind === "onair" ? <circle className="halo" r="16" /> : null}
      {!Number.isNaN(course) && m.kind !== "ghost" ? <path className="wedge" transform={`rotate(${course.toFixed(1)})`} d="M0,-16 L5.5,-8.5 L-5.5,-8.5Z" /> : null}
      <circle className="dot" r={radius} />
      {m.label !== null ? (
        <g transform={`translate(${labelX},-27)`}>
          <rect className="mk-pill" rx="2" width={labelWidth} height="19" />
          <text className="mk-lbl" x="7" y="13.5">
            {m.label}
          </text>
        </g>
      ) : null}
    </g>
  );
}

function graticule(v: View): { lines: string; ticks: string; labels: { text: string; x: number; y: number; axis: "lat" | "lon" }[] } {
  const [x0, y0] = unproject(v, 0, 0);
  const [x1, y1] = unproject(v, v.width, v.height);
  const lon0 = lonOf(x0);
  const lon1 = lonOf(x1);
  const latTop = latOf(y0);
  const latBottom = latOf(y1);
  const steps = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 45, 90];
  const step = steps.find((s) => (lon1 - lon0) / s <= 8) ?? 90;
  const decimals: Decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  let lines = "";
  let ticks = "";
  const labels: { text: string; x: number; y: number; axis: "lat" | "lon" }[] = [];
  for (let lon = Math.ceil(lon0 / step) * step; lon <= lon1; lon += step) {
    const [x] = project(v, mercX(lon), 0);
    lines += `M${x.toFixed(1)} 0V${v.height}`;
    ticks += `M${x.toFixed(1)} 0v8M${x.toFixed(1)} ${v.height}v-8`;
    labels.push({ text: `${fixed(Math.abs(lon), decimals)}° ${lon < 0 ? "W" : "E"}`, x, y: v.height, axis: "lon" });
  }
  for (let lat = Math.ceil(latBottom / step) * step; lat <= latTop; lat += step) {
    const [, y] = project(v, 0, mercY(lat));
    lines += `M0 ${y.toFixed(1)}H${v.width}`;
    ticks += `M0 ${y.toFixed(1)}h8M${v.width} ${y.toFixed(1)}h-8`;
    labels.push({ text: `${fixed(Math.abs(lat), decimals)}° ${lat < 0 ? "S" : "N"}`, x: 0, y, axis: "lat" });
  }
  return { lines, ticks, labels };
}

export function Overlay({ camera, scene, ghost, bare, hudBottom }: {
  camera: Camera;
  scene: Scene;
  ghost?: Track | null;
  bare: boolean;
  hudBottom: number;
}) {
  const v = useSyncExternalStore(camera.onMove, camera.view);
  const merc = useMemo(() => (scene.track === null ? null : mercOf(scene.track)), [scene.track]);
  const ghostMerc = useMemo(() => (ghost == null ? null : mercOf(ghost)), [ghost]);
  const grid = graticule(v);
  const track = scene.track;
  const start = track === null ? null : stateAt(track, 0);
  const end = track === null ? null : stateAt(track, track.duration);
  const startXY = start === null ? null : project(v, mercX(start.lon), mercY(start.lat));
  const endXY = end === null ? null : project(v, mercX(end.lon), mercY(end.lat));
  const far = start !== null && end !== null && Math.hypot((end.lat - start.lat) * 111_000, (end.lon - start.lon) * 111_000 * Math.cos((start.lat * Math.PI) / 180)) > 20;
  const ticks = track === null ? null : ticksOf(v, track);
  const path = track === null || merc === null ? "" : pathOf(v, merc, track);

  return (
    <>
      <svg className="pointer-events-none absolute inset-0 z-[2] h-full w-full" aria-hidden="true">
        {bare ? <path d={grid.lines} fill="none" stroke="var(--line2)" /> : null}
        <path d={grid.ticks} fill="none" stroke="var(--ink3)" strokeWidth={1} />
        {ghost != null && ghostMerc !== null ? <path className="tr-ghost" d={pathOf(v, ghostMerc, ghost)} /> : null}
        {track !== null && merc !== null ? (
          <g>
            <path className="tr-case" d={path} />
            <path className="tr-plan" d={path} />
            {scene.aired.map(([a, b], i) => (
              <path key={i} className="tr-aired" d={pathOf(v, merc, track, a, b)} />
            ))}
            {ticks !== null ? (
              <>
                <path className="tr-tick" d={ticks.minor} />
                <path className="tr-tick mj" d={ticks.major} />
              </>
            ) : null}
          </g>
        ) : null}
        {endXY !== null && far ? (
          <g transform={`translate(${endXY[0].toFixed(1)},${endXY[1].toFixed(1)})`}>
            <rect className="mk-end" x="-5.5" y="-5.5" width="11" height="11" rx="1.5" />
          </g>
        ) : null}
        {startXY !== null ? (
          <g transform={`translate(${startXY[0].toFixed(1)},${startXY[1].toFixed(1)})`}>
            <circle className="mk-start" r="7" />
          </g>
        ) : null}
        {track !== null
          ? scene.markers.map((m) => {
              const s = stateAt(track, m.t);
              if (s === null) return null;
              const [x, y] = project(v, mercX(s.lon), mercY(s.lat));
              return <MarkerShape key={m.key} m={m} x={x} y={y} course={headingAt(track, m.t)} width={v.width} />;
            })
          : null}
      </svg>
      {bare ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[3] font-mono text-micro text-ink2">
          {grid.labels
            .filter((l) => (l.axis === "lon" ? l.x > 40 && l.x < v.width - 60 : l.y > hudBottom && l.y < v.height - 50))
            .map((l) => (
              <span
                key={`${l.axis}${l.text}`}
                className="absolute bg-[color-mix(in_srgb,var(--map-land)_85%,transparent)] px-1 leading-4 whitespace-nowrap"
                style={l.axis === "lon" ? { left: l.x, bottom: 30, transform: "translateX(-50%)" } : { left: 12, top: l.y, transform: "translateY(-50%)" }}
              >
                <Fig>{l.text}</Fig>
              </span>
            ))}
        </div>
      ) : null}
    </>
  );
}
