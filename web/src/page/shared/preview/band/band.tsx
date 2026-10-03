"use client";

import { Fragment, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fixed } from "@/core";
import type { Signal } from "@/model/gnss";
import { openProblems, type Problem } from "@/workbench/feedback";
import type { PreviewFrame, SignalSelection } from "@/model/preview";
import { useProblem } from "@/page/shared/feedback";
import { Button, feedbackClass, FeedbackIcon, Fig, Spinner, useSize } from "@/page/shared/ui";
import { Bars } from "./bars";
import { SkyPlot, skyCounts, skyOf, type Count, type Sat, type Sky } from "./sky";
import { Timeline } from "./timeline";
import { useSignalQueries } from "@/workbench/preview";

function ProblemCue({ problem }: { problem: Problem }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-small">
      <FeedbackIcon level={problem.level} size={14} />
      <span className={feedbackClass(problem.level)}>{problem.title}</span>
      <Button variant="ghost" size="xs" onClick={() => openProblems(problem.id)}>View problem</Button>
    </div>
  );
}

function Counts({ sky, live, scenarioMask, compact = false }: { sky: Sky; live: boolean; scenarioMask: number; compact?: boolean }) {
  const counts = skyCounts(sky, live);
  const [mainValue, mainLabel, mainDot] = counts.main;
  const dot = (kind: Count[2]) => kind === "" ? null : (
    <i className={`mr-1 inline-block size-2 rounded-full ${kind === "on" ? "bg-ink" : kind === "up" ? "shadow-[inset_0_0_0_1.4px_var(--ink)]" : "shadow-[inset_0_0_0_1px_var(--ink4)]"}`} />
  );
  const commandedMask = !sky.geo && Math.abs(sky.mask - scenarioMask) > 1e-6;
  return (
    <div className="flex min-w-0 flex-col gap-1 text-small text-ink2">
      <div>
        {dot(mainDot)}
        <span className="fn text-d2 font-medium tracking-[-0.01em] text-ink">{mainValue}</span> <span className="lab text-ink2">{mainLabel}</span>
      </div>
      <div className={`flex ${compact ? "flex-wrap gap-x-3" : "flex-col"} whitespace-nowrap`}>
        {counts.rest.map(([value, label, dotKind]) => (
          <span key={label}>
            {dot(dotKind)}
            <Fig>{`${value} ${label}`}</Fig>
          </span>
        ))}
      </div>
      <dl className={`m-0 mt-1 grid ${compact ? "grid-cols-[max-content_1fr_max-content_1fr] gap-x-2" : "grid-cols-[max-content_1fr] gap-x-1"} border-t border-line pt-1`}>
        {sky.geo ? null : sky.dop !== null ? (
          Object.entries(sky.dop).map(([key, value]) => (
            <Fragment key={key}>
              <dt className="lab leading-5 text-ink3">{`${key.toUpperCase()}DOP`}</dt>
              <dd className="fn m-0 text-body font-medium text-ink">{value.toFixed(2)}</dd>
            </Fragment>
          ))
        ) : (
          <>
            <dt className="lab leading-5 text-ink3">DOP</dt>
            <dd className="col-span-2 m-0 text-small text-ink2">fewer than 4 with a channel</dd>
          </>
        )}
        <dt className="lab leading-5 text-ink3">Mask</dt>
        <dd className={`fn m-0 justify-self-start text-body font-medium ${commandedMask ? "bg-ink px-1 text-display" : "text-ink"}`} title={commandedMask ? "commanded" : undefined}>
          {`${fixed(sky.mask, 0)}°`}
          {commandedMask ? <span className="vh">, commanded</span> : null}
        </dd>
      </dl>
    </div>
  );
}

export function Band({ frame, onSeek, variant = "all", onSelect, onCommand }: {
  frame: PreviewFrame;
  onSeek(epochMs: number): void;
  variant?: "all" | "sky";
  onSelect?: (target: SignalSelection) => void;
  onCommand?: (target: SignalSelection) => void;
}) {
  const id = useId();
  const { source, scope, note } = frame;
  const sourcePresent = source !== null;
  const { reading, truthError, retry } = useSignalQueries(frame, { timeline: false });
  const owner = `band:${frame.ownerKey}:${variant}:${id}`;
  const sourceProblem = useMemo<Problem | null>(() => note === null ? null : {
    id: `${owner}:source`, level: note.level, scope, title: sourcePresent ? "Preview status" : "Preview unavailable", message: note.message,
  }, [owner, scope, sourcePresent, note?.level, note?.message]);
  const truthProblem = useMemo<Problem | null>(() => truthError === null ? null : {
    id: `${owner}:sky`, level: "error", scope, title: "Sky and C/N0 unavailable", message: truthError,
    actions: [{ id: "retry-preview", label: "Retry preview", run: retry }],
  }, [owner, scope, truthError, retry]);
  useProblem(`${owner}:source`, sourceProblem);
  useProblem(`${owner}:sky`, truthProblem);
  const [folded, setFolded] = useState(false);
  const [pointed, setPointed] = useState<string | null>(null);
  const [box, setBox] = useState<HTMLElement | null>(null);
  const { width, height } = useSize(box);
  const previewHeight = useRef(0);
  const slim = width > 0 && width < 600;
  const spacious = variant === "sky";
  const sideBySide = spacious && width >= 560;
  const widePreview = spacious && width >= 760;
  const skySize = spacious ? widePreview ? 250 : 220 : slim ? 138 : 150;
  const pick = onCommand !== undefined && frame.capabilities.command ? "command" : onSelect !== undefined && frame.capabilities.inspect ? "inspect" : null;
  const sky = reading !== null && source !== null ? skyOf(reading.truth, source.summary.samples === null) : null;
  useLayoutEffect(() => {
    if (sky !== null && height > 0) previewHeight.current = height;
  }, [sky, height]);
  const shownLive = reading?.live === true;
  const selection = frame.selection;
  const picked = (x: Sat, signal?: Signal) => selection?.system === x.system && selection.svid === x.svid
    && (signal === undefined || selection.signal === undefined || selection.signal === signal);
  const fill = (x: Sat, signal?: Signal) => {
    const target: SignalSelection = { system: x.system, svid: x.svid, ...(signal === undefined ? {} : { signal }) };
    if (pick === "inspect") onSelect?.(target);
    if (pick === "command") onCommand?.(target);
  };
  const mood = frame.lanes[0]?.state === "unknown" ? "stale" : frame.lanes[0]?.state === "alarm" ? "frozen" : "";
  const sampling = reading?.pending ? `Showing epoch ${reading.sampledEpochMs} ms · updating to ${frame.sampleEpochMs} ms…` : null;
  const isFolded = variant === "all" && folded;
  const counts = sky === null ? null : skyCounts(sky, shownLive);
  const [mainValue, mainLabel] = counts?.main ?? [];
  const unavailable = sourceProblem ?? truthProblem;
  const summary =
    sky !== null && counts !== null ? (
      <>
        <b className="lab text-ink">Sky</b>
        <span>
          <Fig>{`${mainValue} ${mainLabel}${sky.dop !== null ? ` · PDOP ${sky.dop.p.toFixed(2)}` : ""} · mask ${fixed(sky.mask, 0)}°`}</Fig>
        </span>
        {sampling === null ? null : <span className="min-w-0 text-small whitespace-normal text-ink3">{sampling}</span>}
      </>
    ) : unavailable === null ? null : <ProblemCue problem={unavailable} />;
  return (
    <section
      id={id}
      ref={setBox}
      aria-label="At the cursor"
      aria-busy={source !== null && (reading === null || reading.pending) && truthError === null}
      style={!isFolded && sky === null && source !== null ? { minHeight: previewHeight.current || (variant === "sky" ? 240 : 180) } : undefined}
      className={`grid min-w-0 border-t border-line2 bg-display ${sideBySide ? widePreview ? "grid-cols-[280px_minmax(0,1fr)]" : "grid-cols-[240px_minmax(0,1fr)]" : isFolded || variant !== "all" ? "grid-cols-[minmax(0,1fr)]" : slim ? "grid-cols-[164px_minmax(0,1fr)]" : "grid-cols-[268px_minmax(0,1fr)]"} grid-rows-[auto_auto]`}
    >
      {isFolded || sky === null ? (
        sky !== null || unavailable !== null ? (
          <div className="col-span-full row-start-1 flex min-h-8 min-w-0 items-center gap-3 py-1 pr-2 pl-4 text-small whitespace-nowrap text-ink2">
            {summary}
            <span className="flex-1" />
            {sky !== null && variant === "all" ? (
              <Button variant="ghost" size="xs" icon="chev" aria-expanded={false} aria-controls={id} onClick={() => setFolded(false)}>
                Show sky and C/N0
              </Button>
            ) : null}
          </div>
        ) : <div role="status" className="col-span-full flex min-h-16 items-center gap-2 px-4 py-3 text-small text-ink2">
          {source !== null ? <><Spinner />Reading sky and C/N0…</> : frame.owner.kind === "scenario" ? "Preview available after scenario checks pass." : "Preview needs the submitted bundle and run context."}
        </div>
      ) : sky !== null && source !== null ? (
        <>
          <div className={`${spacious ? sideBySide ? "col-start-1 row-start-1 border-r" : "col-span-full row-start-1 border-b" : "col-start-1 row-span-2 border-r"} flex min-w-0 flex-col gap-1 border-line ${spacious ? widePreview ? "px-3 py-4" : "px-2 py-3" : "py-2 pr-2 pl-3"} ${source.stale ? "opacity-50" : ""}`}>
            <div className={`grid ${spacious ? "items-center gap-3" : "items-start gap-2"} ${spacious ? sideBySide ? "grid-cols-1" : "grid-cols-[220px_minmax(0,1fr)]" : slim ? "grid-cols-1" : "grid-cols-[150px_minmax(0,1fr)]"}`}>
              <SkyPlot sky={sky} live={shownLive} pick={pick} picked={picked} pointed={pointed} onPick={fill} onPoint={setPointed} mood={mood} size={skySize} />
              {slim && variant === "all" ? (
                <div className="text-small text-ink2">
                  <b className="fn font-medium text-ink">{mainValue}</b> {mainLabel}
                  <br />
                  <Fig>{`${sky.dop !== null ? `PDOP ${sky.dop.p.toFixed(2)} · ` : ""}mask ${fixed(sky.mask, 0)}°`}</Fig>
                </div>
              ) : spacious ? (
                <div className={sideBySide ? undefined : "max-w-44"}><Counts sky={sky} live={shownLive} scenarioMask={source.summary.elevationMaskDeg} compact={sideBySide} /></div>
              ) : <Counts sky={sky} live={shownLive} scenarioMask={source.summary.elevationMaskDeg} />}
            </div>
            {sampling === null ? null : <p role="status" className="m-0 mt-1 text-small text-ink3">{sampling}</p>}
          </div>
          <div className={`${spacious && !sideBySide ? "col-span-full row-start-2" : "col-start-2 row-start-1"} flex min-w-0 flex-col ${spacious ? "justify-center gap-3 px-4 py-4" : "gap-1 px-4 pt-2 pb-1"} ${source.stale ? "opacity-50" : ""}`}>
            <div className="lab flex min-h-4 min-w-0 items-center gap-2 whitespace-nowrap text-ink">
              <span>
                C/N0<span className="font-sans text-small font-medium tracking-normal text-ink2 normal-case">, dB-Hz</span>
              </span>
              <span className="flex-1" />
              {variant === "all" ? <Button variant="ghost" size="xs" icon="chev" aria-expanded={true} aria-controls={id} onClick={() => setFolded(true)}>Fold</Button> : null}
            </div>
            {sky.geo ? (
              <p className="m-0 mt-1 text-small text-ink3">Set sample rate and centre in Signals for C/N0.</p>
            ) : (
              <Bars sky={sky} pick={pick} picked={picked} pointed={pointed} onPick={fill} onPoint={setPointed} slim={slim} spacious={spacious} />
            )}
          </div>
        </>
      ) : null}
      {variant === "all" ? <Timeline frame={frame} onSeek={onSeek} wide={isFolded} /> : null}
    </section>
  );
}
