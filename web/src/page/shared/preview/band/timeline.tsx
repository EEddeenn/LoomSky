"use client";

import { useId, useMemo, useState } from "react";
import { clock, duration, offset } from "@/core";
import { gpsClock, gpsDate, gpsEpochUnixMs, utcClock } from "@/model/gnss";
import { moves, stateWidth, type Track } from "@/model/trajectory";
import { useSignalQueries } from "@/workbench/preview";
import { openProblems, type Problem } from "@/workbench/feedback";
import { useProblem } from "@/page/shared/feedback";
import type { PreviewFrame, PreviewLane } from "@/model/preview";
import { Button, Fig, useSize } from "@/page/shared/ui";

function ticks(S: number, D: number): { major: [number, string][]; minor: number[] } {
  const steps = [60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600];
  const step = steps.find((x) => D / 1000 / x <= 7) ?? 43200;
  const minorOf: Record<number, number> = { 60: 10, 120: 30, 300: 60, 600: 120, 900: 300, 1800: 300, 3600: 600, 7200: 1800, 10800: 1800, 21600: 3600, 43200: 7200 };
  const origin = S + gpsEpochUnixMs;
  const major: [number, string][] = [];
  for (let t = Math.ceil(origin / (step * 1000)) * step * 1000; t < origin + D; t += step * 1000) {
    const x = (t - origin) / D;
    if (x > 0.05 && x < 0.95) major.push([x, clock(t).slice(0, 5)]);
  }
  const m = (minorOf[step] ?? step / 5) * 1000;
  const minor: number[] = [];
  for (let t = Math.ceil(origin / m) * m; t < origin + D; t += m) {
    const x = (t - origin) / D;
    if (x > 0.004 && x < 0.996) minor.push(x);
  }
  return { major, minor };
}

function speedPath(track: Track, D: number): string {
  const n = track.states.length / stateWidth;
  const step = Math.max(1, Math.floor(n / 400));
  let top = 1;
  for (let i = 0; i < n; i++) top = Math.max(top, track.states[i * stateWidth + 4] ?? 0);
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i += step) {
    const t = (track.states[i * stateWidth] ?? 0) * 1000;
    if (t > D) break;
    pts.push([(t / D) * 1000, 24 - ((track.states[i * stateWidth + 4] ?? 0) / top) * 22]);
  }
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("");
}

function Lane({ lane, D }: { lane: PreviewLane; D: number }) {
  const c = lane.state;
  const P = (ms: number) => `${Math.min(100, Math.max(0, (ms / D) * 100)).toFixed(3)}%`;
  const replay = lane.replay;
  const sent = lane.sentMs;
  const first = lane.firstMs;
  const entry = lane.epochMs;
  const parts = [];
  if (c === "armed" && entry !== null) {
    parts.push(<span key="armed" className="absolute top-0 bottom-0 bg-display shadow-[inset_0_0_0_2px_var(--rf-mark)]" style={{ left: P(entry), width: "max(14px,1.5%)" }} />);
  }
  if (sent !== null && sent > first)
    parts.push(
      <span
        key="aired"
        className="absolute top-0 bottom-0"
        style={{ left: P(first), width: P(sent - first), background: replay ? "repeating-linear-gradient(90deg,var(--aired) 0 6px,transparent 6px 8px)" : "var(--aired)" }}
      />,
    );
  if (c === "unknown" && sent !== null && lane.unknownUntilMs !== null) {
    parts.push(<span key="unknown" className="hatch absolute top-0 bottom-0 shadow-[inset_0_0_0_1px_var(--rf-mark)]" style={{ left: P(sent), width: P(lane.unknownUntilMs - sent) }} />);
  }
  for (const [i, command] of lane.commands.entries()) {
    parts.push(
      <span
        key={`c${i}`}
        title={command.label}
        className="absolute -top-1.5 -ml-1 h-0 w-0 border-x-4 border-t-[5px] border-x-transparent border-t-ink2"
        style={{ left: P(command.epochMs) }}
      />,
    );
  }
  for (const [i, fault] of lane.faults.entries())
    parts.push(
      <span key={`f${i}`} title={fault.label} className="absolute -top-2 -ml-0.5 font-sans text-micro leading-[11px] font-bold text-warn-ink" style={{ left: P(fault.epochMs) }}>
        !
      </span>,
    );
  if (c === "onair" && sent !== null) parts.push(<span key="ph" className="absolute -top-1 -bottom-1 -ml-[1.5px] w-[3px] bg-rf-mark" style={{ left: P(sent) }} />);
  if (lane.end !== null)
    parts.push(<span key="end" title={lane.end.label} className={`absolute -top-1 -bottom-1 w-0.5 ${lane.end.alarm ? "bg-fault" : "bg-ink"}`} style={{ left: P(lane.end.epochMs) }} />);
  if (replay && sent !== null && sent > first)
    parts.push(
      <span key="own" className="absolute -top-0.5 right-0 bg-display pl-1 text-micro leading-3 font-medium whitespace-nowrap text-ink3">
        own clock
      </span>,
    );
  return (
    <div className="absolute top-1 right-0 left-0 h-2 bg-display shadow-[inset_0_0_0_1px_var(--line2)]" title={lane.label}>
      {parts}
    </div>
  );
}

export function Timeline({ frame, onSeek, wide = true }: { frame: PreviewFrame; onSeek(epochMs: number): void; wide?: boolean }) {
  const id = useId();
  const { lane, laneError, retry } = useSignalQueries(frame, { sky: false });
  const problem = useMemo<Problem | null>(() => laneError === null ? null : {
    id: `timeline:${frame.ownerKey}:${id}`, level: "error", scope: frame.scope,
    title: "Satellite timeline unavailable", message: laneError,
    actions: [{ id: "retry-preview", label: "Retry preview", run: retry }],
  }, [frame.ownerKey, frame.scope, id, laneError, retry]);
  useProblem(id, problem);
  const [plot, setPlot] = useState<HTMLDivElement | null>(null);
  const plotWidth = useSize(plot).width;
  const track = frame.track !== null && moves(frame.track) ? frame.track : null;
  const speed = useMemo(() => track === null ? "" : speedPath(track, Math.max(1, frame.window?.durationMs ?? 1)), [track, frame.window?.durationMs]);
  if (frame.window === null) return null;
  const { startGpsMs: S, durationMs, leap } = frame.window;
  const D = Math.max(1, durationMs);
  const lanes = frame.lanes;
  const riding = frame.following;
  const t = frame.epochMs;
  const P = (ms: number) => Math.min(100, Math.max(0, (ms / D) * 100));
  const set = (clientX: number) => {
    if (plot === null || !frame.capabilities.seek) return;
    const r = plot.getBoundingClientRect();
    onSeek(Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * D));
  };

  const width = plotWidth === 0 ? 800 : plotWidth;
  const marks = ticks(S, D);
  const endText = gpsClock(S + D);
  const endWidth = (endText.length * 6.6 + 14) / width;
  const full = `${gpsClock(S + t, true)} GPS · ${utcClock(S + t, leap, true)} UTC · ${offset(t)}`;
  const flag = width >= full.length * 7.2 + 40 ? full : `${gpsClock(S + t, true)} GPS · ${offset(t)}`;
  const flagWidth = flag.length * 7.2 + 12;
  const flagX = Math.max(0, Math.min(width - flagWidth + 6, (P(t) / 100) * width - flagWidth / 2)) - (P(t) / 100) * width;

  const lanePoints = lane?.lane ?? null;
  const counts = lanePoints?.counts ?? [];
  const lo = counts.length > 0 ? Math.min(...counts) : 0;
  const hi = counts.length > 0 ? Math.max(...counts) : 0;
  let satellitePath = "";
  if (lanePoints !== null && counts.length > 0) {
    const base = Math.max(0, lo - 2);
    const span = hi + 1 - base;
    counts.forEach((n, i) => {
      const X = (Math.min(D, i * lanePoints.stepMs) / D) * 1000;
      const Y = 19 - ((n - base) / span) * 17;
      satellitePath += i === 0 ? `M${X.toFixed(1)} ${Y.toFixed(1)}` : `H${X.toFixed(1)}V${Y.toFixed(1)}`;
    });
  }

  const gpsNowMs = frame.nowGpsMs;
  const showNow = gpsNowMs !== null && gpsNowMs >= S && gpsNowMs <= S + D;

  return (
    <section aria-label="Timeline" className={`${wide ? "col-span-full" : "col-start-2"} row-start-2 grid min-w-0 grid-cols-[84px_minmax(0,1fr)_12px] border-t border-line bg-display py-1 select-none`}>
      <div className="flex flex-col pl-4 lab text-ink2">
        <div className="flex h-6 items-center font-mono text-micro font-normal tracking-normal text-ink3">{gpsDate(S)}</div>
        <div className="flex h-4 items-center text-ink">GPS</div>
        {track !== null ? <div className="flex h-6 items-center">speed</div> : null}
        {satellitePath !== "" ? (
          <div className="flex h-6 items-center whitespace-nowrap" title="satellites above the mask">
            sats&nbsp;<span className="fn font-normal text-ink3">{lo === hi ? lo : `${lo}–${hi}`}</span>
          </div>
        ) : null}
        {lanes.map((h) => (
          <div key={h.key} className="flex h-4 items-center overflow-hidden font-sans text-micro font-medium tracking-normal whitespace-nowrap text-ink normal-case">
            {h.label}
          </div>
        ))}
      </div>
      <div className="group relative min-w-0">
        <div
          ref={setPlot}
          className="relative min-w-0 cursor-ew-resize touch-none"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            set(e.clientX);
          }}
          onPointerMove={(e) => {
            if (e.buttons !== 0) set(e.clientX);
          }}
        >
          <div className="relative h-6" />
          <div className="relative h-4">
            <div className="absolute inset-x-0 top-0 h-4 border-b border-ink3">
              {marks.minor.map((x) => (
                <span key={x} className="absolute bottom-0 h-[3px] border-l border-ink4" style={{ left: `${(x * 100).toFixed(3)}%` }} />
              ))}
              {marks.major
                .filter(([x]) => x > 62 / width + 0.01 && x < 1 - endWidth - 40 / width)
                .map(([x, text]) => (
                  <span
                    key={x}
                    className="absolute top-0 h-4 pl-1 font-mono text-micro leading-3 whitespace-nowrap text-ink2 before:absolute before:bottom-0 before:left-0 before:h-[7px] before:border-l before:border-ink3 before:content-['']"
                    style={{ left: `${(x * 100).toFixed(3)}%` }}
                  >
                    {text}
                  </span>
                ))}
            </div>
            <div className="pointer-events-none absolute inset-x-0 top-0 flex h-4 items-start justify-between font-mono text-micro leading-3 font-semibold text-ink">
              <span className="bg-display pr-1 whitespace-nowrap">{gpsClock(S)}</span>
              <span className="bg-display pl-1 font-medium whitespace-nowrap text-ink2">{endText}</span>
            </div>
          </div>
          {track !== null ? (
            <div className="relative h-6">
              <svg className="absolute inset-x-0 inset-y-[3px] block h-[18px] w-full overflow-visible" viewBox="0 0 1000 24" preserveAspectRatio="none" aria-hidden="true">
                <path d={`${speed}L1000 24L0 24Z`} fill="color-mix(in srgb, var(--ink) 8%, transparent)" />
                <path d={speed} fill="none" stroke="var(--ink2)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
              </svg>
            </div>
          ) : null}
          {satellitePath !== "" ? (
            <div className="relative h-6">
              <svg className="absolute inset-x-0 inset-y-[3px] block h-[18px] w-full" viewBox="0 0 1000 20" preserveAspectRatio="none" aria-hidden="true">
                <path d={`${satellitePath}H1000V20H0Z`} fill="color-mix(in srgb, var(--ink) 10%, transparent)" />
                <path d={`${satellitePath}H1000`} fill="none" stroke="var(--ink3)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              </svg>
            </div>
          ) : null}
          {lanes.map((h) => (
            <div key={h.key} className="relative h-4">
              <Lane lane={h} D={D} />
            </div>
          ))}
          {showNow && gpsNowMs !== null ? (
            <div className="pointer-events-none absolute top-6 bottom-0 w-0 border-l border-dashed border-ink2" style={{ left: `${P(gpsNowMs - S)}%` }}>
              {Math.abs(P(gpsNowMs - S) - P(t)) < 4 ? null : <span className="lab absolute -top-5 -left-3.5 bg-display px-0.5 leading-3 text-ink">now</span>}
            </div>
          ) : null}
          <div className={`pointer-events-none absolute top-4 bottom-0 w-0 ${riding ? "-ml-px border-l-2 border-rf-mark" : "border-l border-ink"}`} style={{ left: `${P(t)}%` }}>
            <span className={`absolute top-0 group-has-[input:focus-visible]:outline-2 group-has-[input:focus-visible]:outline-offset-3 group-has-[input:focus-visible]:outline-(--focus) h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent ${riding ? "-left-1.5 border-t-rf-mark" : "-left-[5.5px] border-t-ink"}`} />
            {riding ? null : (
              <span className="fn absolute -top-4 h-4 bg-sel px-1.5 text-small leading-4 font-medium whitespace-nowrap text-on-sel" style={{ left: flagX }}>
                <Fig>{flag}</Fig>
              </span>
            )}
          </div>
        </div>
        <input
          type="range"
          aria-label="Time cursor"
          min={0}
          max={D}
          step={1}
          value={t}
          disabled={!frame.capabilities.seek}
          aria-valuetext={`${gpsClock(S + t)} GPS, ${utcClock(S + t, leap)} UTC, ${duration(t)} into the window${riding ? ", following the epoch sent" : ""}`}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="pointer-events-none absolute inset-x-0 top-10 m-0 h-6 w-full opacity-0"
        />
      </div>
      <div />
      {problem === null ? null : <div className="col-span-full flex items-center gap-2 border-t border-line px-4 py-1 text-small text-fault">
        <span>{problem.title}</span>
        <Button variant="ghost" size="xs" onClick={() => openProblems(problem.id)}>View problem</Button>
      </div>}
    </section>
  );
}
