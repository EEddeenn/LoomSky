"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react";
import { offset, trimmed } from "@/core";
import type { PreviewFrame } from "@/model/preview";
import type { Plan, PlanRule, PlanScope } from "@/model/trajectory";
import { Button, Softkeys } from "@/page/shared/ui";
import type { TrajectoryDoc } from "@/workbench/documents/trajectory";
import type { EditOutcome, Selection, TrajectorySession } from "@/workbench/documents/trajectory/editing";
import { freshPlanId } from "@/model/trajectory";
import { QuantityChart, type NumericHandle, type TimeRange } from "./timeline/chart";
import { numericValues, plotSamples, quantities, ruleMarks, schedule, scopeRange, type EventMark } from "./timeline/data";
import { clamp, plotBounds, sampleAt, timeX, valueY, type PlotBounds } from "./timeline/plot";

type TrajectoryTimelineProps = {
  doc: TrajectoryDoc;
  plan: Plan | null;
  frame: PreviewFrame;
  onSeek(epochMs: number): void;
  selected: Selection;
  session: TrajectorySession;
  expanded: boolean;
  onExpandedChange(expanded: boolean): void;
  onSelect(selection: Selection): void;
  onOutcome(outcome: EditOutcome): void;
};
type Command = Parameters<TrajectorySession["execute"]>[0];
type Handle = {
  selection: NonNullable<Selection>;
  kind: "event" | "hard" | "target";
  estimated?: boolean;
  label: string;
  axis: "time" | "value";
  value: number;
  time: number;
  min: number;
  command(value: number): Command;
};
type Capture = { target: HTMLElement; pointer: number; releaseInteraction?: () => void };
type Gesture = Capture & (
  | { kind: "edit"; token: symbol; handle: Handle; x: number; y: number; width: number; height: number; bounds: PlotBounds; latest: number; cursor: number }
  | { kind: "seek" | "range"; anchor: number; cursor: number; range: TimeRange | null; rangeValue: string; rangeAuthored: boolean }
  | { kind: "resize"; y: number; height: number }
);

const rounded = (value: number) => Math.round(value * 100) / 100;
const release = (capture: Capture) => {
  if (capture.target.hasPointerCapture(capture.pointer)) capture.target.releasePointerCapture(capture.pointer);
};

export function TrajectoryTimeline({ doc, plan, frame, onSeek, selected, session, expanded, onExpandedChange, onSelect, onOutcome }: TrajectoryTimelineProps) {
  const cursor = frame.epochMs;
  const track = frame.track;
  const { quantity } = useSyncExternalStore(session.subscribe, session.get, session.get).timeline;
  const { range, value: rangeValue, authored: rangeAuthored } = session.rangeDraft;
  const [height, setHeight] = useState(220);
  const collapsed = !expanded;
  const [rangeMode, setRangeMode] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [frozen, setFrozen] = useState<PlotBounds | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const callbacks = useRef({ cancel: () => {} });
  const model = schedule(plan, track);
  const samples = plotSamples(track, quantity);
  const marks = ruleMarks(plan, quantity, model.events, model.sections, model.duration);
  const metric = quantities.find((item) => item.key === quantity) ?? quantities[0];
  const validRangeValue = rangeValue.trim() !== "" && Number.isFinite(Number(rangeValue)) && (quantity === "altitude" || Number(rangeValue) >= 0);
  const bounds = frozen ?? plotBounds(model.duration, [...samples.map((sample) => sample.value), ...marks.flatMap((mark) => mark.values.map((numeric) => numeric.value))], quantity !== "altitude");
  const at = clamp(cursor / 1000, 0, bounds.duration);
  const currentValue = sampleAt(samples, at);
  const writable = plan !== null && doc.editor.writable();
  const selectedRule = selected?.kind === "rule" ? selected.id : null;
  const selectedEvent = selected?.kind === "event" ? model.events.find((event) => event.id === selected.id) : undefined;
  const selectedSection = selected?.kind === "section" ? model.sections.find((section) => section.id === selected.id) : undefined;
  const rule = selectedRule === null ? undefined : plan?.rules.find((rule) => rule.id === selectedRule);
  const highlight = selectedEvent !== undefined ? { from: selectedEvent.time, to: selectedEvent.time }
    : selectedSection !== undefined ? { from: selectedSection.from, to: selectedSection.to }
    : rule === undefined ? null : scopeRange(rule.scope, model.events, model.sections, bounds.duration);
  const seek = (seconds: number) => onSeek(Math.round(clamp(seconds, 0, bounds.duration) * 1000));
  const pointerTime = (event: PointerEvent<HTMLElement>, target: HTMLElement) => {
    const rectangle = target.getBoundingClientRect();
    return rounded(clamp(((event.clientX - rectangle.left) / rectangle.width - 0.01) / 0.98, 0, 1) * bounds.duration);
  };
  const clearGesture = (cancelled: boolean) => {
    const current = gesture.current;
    if (current === null) return;
    gesture.current = null;
    current.releaseInteraction?.();
    release(current);
    setFrozen(null);
    setHint(null);
    if (current.kind === "edit") {
      if (!session.owns(current.token)) return;
      if (cancelled || current.latest === current.handle.value) session.cancel(current.token);
      else onOutcome(session.commit(current.token));
      if (cancelled) onSeek(current.cursor);
    } else if (cancelled && (current.kind === "seek" || current.kind === "range")) {
      onSeek(current.cursor);
      session.setRange(current.range, current.rangeValue, current.rangeAuthored);
    } else if (cancelled && current.kind === "resize") setHeight(current.height);
  };
  callbacks.current = { cancel: () => clearGesture(true) };

  useEffect(() => {
    const unsubscribe = session.subscribe(() => {
      const current = gesture.current;
      if (current?.kind === "edit" && !session.owns(current.token)) callbacks.current.cancel();
    });
    return () => {
      unsubscribe();
      callbacks.current.cancel();
    };
  }, [session]);

  useEffect(() => {
    if (!expanded) callbacks.current.cancel();
  }, [expanded]);

  const eventHandle = (event: EventMark): Handle => ({
    selection: { kind: "event", id: event.id }, kind: "event", estimated: event.estimated, label: `${event.id} time`, axis: "time", value: event.time, time: event.time, min: 0,
    command: (time) => ({ type: "set-event-time", id: event.id, time }),
  });
  const numericHandle = ({ mark, numeric }: NumericHandle): Handle => ({
    selection: { kind: "rule", id: mark.id }, kind: mark.kind, label: `${mark.label} · ${numeric.field === "eq" ? "Exact value" : numeric.field === "value" ? "Target" : numeric.field === "min" ? "Minimum" : "Maximum"}`, axis: "value", value: numeric.value,
    time: (mark.from + mark.to) / 2, min: quantity === "altitude" ? -Infinity : 0,
    command: (value) => ({ type: "set-rule-value", id: mark.id, field: numeric.field, value }),
  });
  const beginHandle = (event: PointerEvent<HTMLButtonElement>, handle: Handle) => {
    if (event.button !== 0 || gesture.current !== null) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(handle.selection);
    seek(handle.time);
    if (!writable) return;
    const outcome = session.begin(`Edit ${handle.label}`);
    if (!outcome.ok) { onOutcome(outcome); return; }
    const rectangle = event.currentTarget.parentElement?.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      kind: "edit", token: outcome.token, handle, target: event.currentTarget, pointer: event.pointerId, x: event.clientX, y: event.clientY,
      width: rectangle?.width ?? 1, height: rectangle?.height ?? 1, bounds, latest: handle.value, cursor,
    };
    gesture.current.releaseInteraction = session.captureInteraction(() => callbacks.current.cancel());
    setFrozen(bounds);
    setHint(`${handle.label} · ${trimmed(handle.value)} ${handle.axis === "time" ? "s" : metric.unit} · Esc to cancel`);
  };
  const moveGesture = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (current === null || event.pointerId !== current.pointer) return;
    if (current.kind === "resize") { setHeight(clamp(current.height + current.y - event.clientY, 220, 420)); return; }
    if (current.kind !== "edit") {
      const time = pointerTime(event, current.target);
      if (current.kind === "range") session.setRange({ from: Math.min(current.anchor, time), to: Math.max(current.anchor, time) });
      else seek(time);
      return;
    }
    event.stopPropagation();
    if (!session.owns(current.token)) { clearGesture(true); return; }
    const pixels = current.handle.axis === "time" ? event.clientX - current.x : current.y - event.clientY;
    const delta = current.handle.axis === "time" ? (pixels / (current.width * 0.98)) * current.bounds.duration
      : (pixels / (current.height * 0.88)) * (current.bounds.high - current.bounds.low);
    const value = Math.abs(pixels) < 2 ? current.handle.value : rounded(Math.max(current.handle.min, current.handle.value + delta));
    if (value === current.latest) return;
    const outcome = session.previewCommand(current.token, current.handle.command(value));
    if (!outcome.ok) { clearGesture(true); onOutcome(outcome); return; }
    current.latest = value;
    if (current.handle.axis === "time") onSeek(Math.round(value * 1000));
    setHint(`${current.handle.label} · ${trimmed(value)} ${current.handle.axis === "time" ? "s" : metric.unit} · Esc to cancel`);
  };
  const endGesture = (event: PointerEvent<HTMLElement>, cancelled: boolean) => {
    if (gesture.current?.pointer !== event.pointerId) return;
    if (!cancelled) moveGesture(event);
    clearGesture(cancelled);
  };
  const keyHandle = (event: KeyboardEvent<HTMLButtonElement>, handle: Handle) => {
    const direction = handle.axis === "time" ? (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0)
      : event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
    if (direction === 0 || !writable) return;
    event.preventDefault();
    event.stopPropagation();
    if (gesture.current !== null) return;
    onSelect(handle.selection);
    const value = rounded(Math.max(handle.min, handle.value + direction * (event.shiftKey ? 1 : event.altKey ? 0.01 : 0.1)));
    const outcome = session.execute(handle.command(value));
    onOutcome(outcome);
    if (outcome.ok) {
      if (handle.axis === "time") onSeek(Math.round(value * 1000));
      else seek(handle.time);
    }
  };
  const renderHandle = (handle: Handle) => {
    const timed = handle.axis === "time";
    const event = handle.kind === "event";
    const unit = timed ? "s" : metric.unit;
    const active = selected?.kind === handle.selection.kind && selected.id === handle.selection.id;
    const valueText = `${trimmed(handle.value)} ${unit}${handle.estimated ? ", estimated" : ""}`;
    return <button key={`${handle.selection.id}:${handle.label}`} type="button" role="slider"
      aria-label={`${handle.label}${handle.estimated ? " estimate" : ""}`} aria-orientation={timed ? "horizontal" : "vertical"}
      aria-valuenow={handle.value} aria-valuemin={timed ? 0 : Math.min(bounds.low, handle.value)} aria-valuemax={Math.max(timed ? bounds.duration : bounds.high, handle.value)}
      aria-valuetext={valueText} aria-disabled={!writable} title={`${handle.label} · ${valueText}. Drag or use ${timed ? "Left/Right" : "Up/Down"}; Shift adjusts by 1.`}
      onPointerDown={(pointer) => beginHandle(pointer, handle)} onKeyDown={(key) => keyHandle(key, handle)}
      onClick={(pointer) => { pointer.stopPropagation(); if (pointer.detail === 0) { onSelect(handle.selection); seek(handle.time); } }}
      className={`absolute z-20 -translate-x-1/2 touch-none ${event ? "top-1 max-w-[150px] rounded-key border px-1.5 py-0.5 text-micro" : `-translate-y-1/2 ${timed ? "top-8 h-2.5 w-2.5 border" : "h-3 w-3 border-2"} ${handle.kind === "target" ? "rotate-45" : "rounded-key"}`} ${writable ? timed ? "cursor-ew-resize" : "cursor-ns-resize" : "cursor-pointer"} ${active ? "border-ink bg-ink text-display" : event ? "border-line2 bg-face text-ink2" : "border-ink3 bg-display hover:border-ink"} ${handle.estimated ? "border-dashed" : ""}`}
      style={{ left: `${timeX(handle.time, bounds.duration)}%`, top: timed ? undefined : `${valueY(handle.value, bounds)}%`, transform: event ? handle.time < bounds.duration * 0.08 ? "none" : handle.time > bounds.duration * 0.92 ? "translateX(-100%)" : undefined : undefined }}>
      {event ? <span className="block truncate">{handle.selection.id}</span> : null}
    </button>;
  };
  const beginPlot = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || gesture.current !== null) return;
    event.preventDefault();
    const time = pointerTime(event, event.currentTarget);
    const kind = writable && (event.shiftKey || rangeMode) ? "range" : "seek";
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { kind, target: event.currentTarget, pointer: event.pointerId, anchor: time, cursor, range, rangeValue, rangeAuthored };
    gesture.current.releaseInteraction = session.captureInteraction(() => callbacks.current.cancel());
    if (kind === "range") {
      const value = sampleAt(samples, time);
      session.setRange({ from: time, to: time }, value === null ? "" : String(rounded(value)));
      setHint("Select the rule's time range · Esc to cancel");
    } else seek(time);
  };
  const plotKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const step = event.shiftKey ? 1 : 0.1;
    const next = event.key === "Home" ? 0 : event.key === "End" ? bounds.duration
      : event.key === "ArrowRight" ? at + step : event.key === "ArrowLeft" ? at - step : null;
    if (next === null) return;
    event.preventDefault();
    seek(next);
  };
  const createRule = (kind: "hard" | "target") => {
    if (range === null || plan === null) return;
    const value = Number(rangeValue);
    const from = Math.min(range.from, range.to);
    const to = Math.max(range.from, range.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to > bounds.duration || to <= from) {
      setHint(`Choose a nonempty range within 0–${trimmed(bounds.duration)} s.`);
      return;
    }
    if (rangeValue.trim() === "" || !Number.isFinite(value) || (quantity !== "altitude" && value < 0)) {
      setHint("Enter a valid number.");
      return;
    }
    const id = freshPlanId(plan, `${metric.label.toLowerCase()}-${kind === "hard" ? "limit" : "target"}`);
    const scope: PlanScope = { timeRange: [rounded(from), rounded(to)] };
    const rule: PlanRule = kind === "hard" ? { id, kind, quantity, scope, range: { max: value } }
      : { id, kind, quantity, scope, value };
    const outcome = session.execute({ type: "add-rule", rule }, `Add ${metric.label.toLowerCase()} ${kind === "hard" ? "limit" : "target"}`);
    onOutcome(outcome);
    if (outcome.ok) { onSelect({ kind: "rule", id }); session.clearRange(); setRangeMode(false); setHint(null); }
  };
  const timeHandles = (plan?.rules ?? []).flatMap((rule) => {
    if (!("quantity" in rule) || rule.quantity !== "time" || rule.kind === "objective") return [];
    return numericValues(rule).map((numeric) => ({
      selection: { kind: "rule", id: rule.id }, kind: rule.kind, label: `${rule.id} · ${numeric.field === "eq" ? "Exact value" : numeric.field === "value" ? "Target" : numeric.field === "min" ? "Minimum" : "Maximum"}`, axis: "time",
      value: numeric.value, time: numeric.value, min: 0,
      command: (value) => ({ type: "set-rule-value", id: rule.id, field: numeric.field, value }),
    } satisfies Handle));
  });
  const timeWindows = (plan?.rules ?? []).flatMap((rule) => {
    if (!("quantity" in rule) || rule.quantity !== "time" || rule.kind !== "hard" || rule.range === undefined) return [];
    const from = typeof rule.range.min === "number" ? rule.range.min : 0;
    const to = typeof rule.range.max === "number" ? rule.range.max : bounds.duration;
    return [{ id: rule.id, from, to }];
  });
  const status = track?.inspection?.solve;
  const plotCurrent = track !== null && (track === doc.view?.currentTrack || track === doc.view?.previewTrack);
  const hasTiming = model.duration > 0;

  return (
    <section aria-label="Trajectory timeline" className="relative flex min-h-0 min-w-0 flex-none flex-col border-t border-line2 bg-display px-3" style={{ height: collapsed ? 40 : height + (range === null ? 0 : 32), maxHeight: collapsed ? "100%" : "min(60%, 420px)" }}
      onPointerMove={moveGesture} onPointerUp={(event) => endGesture(event, false)} onPointerCancel={(event) => endGesture(event, true)} onLostPointerCapture={(event) => endGesture(event, true)}
      onPointerDownCapture={(event) => {
        if (gesture.current !== null && gesture.current.pointer !== event.pointerId) { event.preventDefault(); event.stopPropagation(); }
      }}
      onClickCapture={(event) => {
        if (gesture.current !== null) { event.preventDefault(); event.stopPropagation(); }
      }}>
      <div role="separator" tabIndex={0} aria-label="Timeline height" aria-orientation="horizontal" aria-valuemin={220} aria-valuemax={420} aria-valuenow={height}
        className="absolute inset-x-0 -top-1 z-30 h-2 cursor-ns-resize touch-none"
        onPointerDown={(event) => {
          if (event.button !== 0 || gesture.current !== null) return;
          event.preventDefault(); onExpandedChange(true); event.currentTarget.setPointerCapture(event.pointerId);
          gesture.current = { kind: "resize", target: event.currentTarget, pointer: event.pointerId, y: event.clientY, height };
          gesture.current.releaseInteraction = session.captureInteraction(() => callbacks.current.cancel());
        }}
        onKeyDown={(event) => {
          const next = event.key === "ArrowUp" ? height + 16 : event.key === "ArrowDown" ? height - 16 : event.key === "Home" ? 220 : event.key === "End" ? 420 : null;
          if (next === null) return;
          event.preventDefault(); onExpandedChange(true); setHeight(clamp(next, 220, 420));
        }} />
      <header className={`flex min-w-0 flex-none items-center gap-2 overflow-x-auto whitespace-nowrap ${collapsed ? "h-10" : "h-9"}`}>
        <span className="lab shrink-0 text-ink2">Timeline</span>
        <span className="fn shrink-0 text-small">{hasTiming ? offset(at * 1000) : "No timing"}</span>
        {collapsed ? <input aria-label="Trajectory time cursor" aria-valuetext={hasTiming ? offset(at * 1000) : "No timing"} type="range" min={0} max={Math.round(model.duration * 1000)} step={10} value={hasTiming ? Math.round(at * 1000) : 0} disabled={!hasTiming}
          onChange={(event) => seek(Number(event.target.value) / 1000)} className="h-4 min-w-24 flex-1 accent-ink" />
          : <Softkeys label="Chart quantity" options={quantities.map((item) => [item.key, item.label] as const)} value={quantity} onChange={(next) => { clearGesture(true); session.setQuantity(next); }} className="shrink-0 text-small" />}
        {currentValue === null ? null : <span className="fn shrink-0 text-small text-ink3">{collapsed ? `${metric.label} ` : ""}{trimmed(currentValue)} {metric.unit}</span>}
        {track === null ? <span className="shrink-0 text-small text-ink3">No solved result</span> : null}
        {track !== null && !plotCurrent ? <span className="text-small text-ink3">Previous result</span>
          : status !== undefined && !status.verified ? <span className="text-small text-ink3">Unverified candidate</span> : null}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {collapsed ? null : <Button size="xs" variant={rangeMode ? "primary" : "ghost"} disabled={!writable} aria-pressed={rangeMode} onClick={() => {
            clearGesture(true); setRangeMode(!rangeMode);
            if (!rangeMode && range === null) {
              const from = Math.min(at, Math.max(0, bounds.duration - 1));
              session.setRange({ from, to: Math.min(bounds.duration, from + Math.max(1, bounds.duration / 5)) }, currentValue === null ? "" : String(rounded(currentValue)));
            }
          }}>Select range</Button>}
          <Button size="xs" variant="ghost" aria-expanded={expanded} aria-controls={`trajectory-timeline-${doc.id}`} onClick={() => { clearGesture(true); onExpandedChange(!expanded); }}>{collapsed ? "Charts" : "Collapse"}</Button>
        </div>
      </header>
      {collapsed ? null : <div id={`trajectory-timeline-${doc.id}`} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
        <div className="grid h-10 flex-none grid-cols-[76px_minmax(0,1fr)] items-center border-t border-line">
          <span className="text-small text-ink2">Events</span>
          <div className="relative h-full touch-none" onPointerDown={beginPlot}>
            {timeWindows.map((window) => <span key={window.id} className="pointer-events-none absolute top-7 h-2 rounded-key bg-ink/15" style={{ left: `${timeX(window.from, bounds.duration)}%`, width: `${Math.max(0, timeX(window.to, bounds.duration) - timeX(window.from, bounds.duration))}%` }} />)}
            {model.events.map((event) => <span key={event.id} className="pointer-events-none absolute inset-y-0 border-l border-dashed border-line2" style={{ left: `${timeX(event.time, bounds.duration)}%` }} />)}
            {model.events.map((event) => renderHandle(eventHandle(event)))}
            {timeHandles.map(renderHandle)}
            <span className="pointer-events-none absolute inset-y-0 border-l border-ink" style={{ left: `${timeX(at, bounds.duration)}%` }} />
          </div>
        </div>
        <div className="grid h-6 flex-none grid-cols-[76px_minmax(0,1fr)] items-center border-t border-line">
          <span className="text-small text-ink2">Sections</span>
          <div className="relative h-full">
            {model.sections.map((section) => <button key={section.id} type="button" aria-pressed={selectedSection?.id === section.id} title={`${section.id} · ${trimmed(section.to - section.from)} s`}
              onClick={() => { onSelect({ kind: "section", id: section.id }); seek(section.from); }}
              className={`absolute inset-y-0 min-w-1 truncate border-x border-line2 px-1 text-left text-micro ${selectedSection?.id === section.id ? "bg-ink/15 text-ink" : "bg-inset text-ink3 hover:bg-hover"}`}
              style={{ left: `${timeX(section.from, bounds.duration)}%`, width: `${Math.max(0, timeX(section.to, bounds.duration) - timeX(section.from, bounds.duration))}%` }}>{section.id}</button>)}
            <span className="pointer-events-none absolute inset-y-0 border-l border-ink" style={{ left: `${timeX(at, bounds.duration)}%` }} />
          </div>
        </div>
        <div className="flex min-h-20 flex-1 flex-col"><QuantityChart samples={samples} bounds={bounds} marks={marks} cursor={at} selectedRule={selectedRule} range={range} highlight={highlight} unit={metric.unit}
          onSeek={beginPlot} onKeyDown={plotKey}>
          {marks.flatMap((mark) => mark.values.map((numeric) => renderHandle(numericHandle({ mark, numeric }))))}
        </QuantityChart></div>
        <div className="ml-[76px] flex h-6 flex-none items-center gap-2">
          <span className="fn text-micro text-ink3">0 s</span>
          <input aria-label="Trajectory time cursor" aria-valuetext={hasTiming ? offset(at * 1000) : "No timing"} type="range" min={0} max={Math.round(model.duration * 1000)} step={10} value={hasTiming ? Math.round(at * 1000) : 0} disabled={!hasTiming}
            onChange={(event) => seek(Number(event.target.value) / 1000)} className="h-4 min-w-0 flex-1 accent-ink" />
          <span className="fn text-micro text-ink3">{hasTiming ? `${trimmed(model.duration)} s` : "—"}</span>
        </div>
        {range === null ? null : <div className="flex h-8 flex-none items-center gap-2 overflow-x-auto border-t border-line text-small whitespace-nowrap">
          <span className="text-ink3">Range</span>
          <input aria-label="Rule range start in seconds" type="number" min={0} max={bounds.duration} step={0.1} value={rounded(range.from)} onChange={(event) => session.setRange({ ...range, from: Number(event.target.value) }, undefined, true)} className="fn h-6 w-16 rounded-key bg-face px-1.5 ring-field" />
          <span className="text-ink3">to</span>
          <input aria-label="Rule range end in seconds" type="number" min={0} max={bounds.duration} step={0.1} value={rounded(range.to)} onChange={(event) => session.setRange({ ...range, to: Number(event.target.value) }, undefined, true)} className="fn h-6 w-16 rounded-key bg-face px-1.5 ring-field" />
          <span className="text-ink3">s · {metric.label}</span>
          <input aria-label={`${metric.label} rule value`} type="number" min={quantity === "altitude" ? undefined : 0} step={0.1} value={rangeValue} onChange={(event) => session.setRangeValue(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); createRule("hard"); } }} className="fn h-6 w-20 rounded-key bg-face px-1.5 ring-field" />
          <span className="text-ink3">{metric.unit}</span>
          <Button size="xs" disabled={!writable || !validRangeValue} onClick={() => createRule("hard")}>Add maximum</Button>
          <Button size="xs" disabled={!writable || !validRangeValue} onClick={() => createRule("target")}>Add target</Button>
          <Button size="xs" variant="ghost" onClick={() => { session.clearRange(); setRangeMode(false); setHint(null); }}>Clear</Button>
        </div>}
        <p className="m-0 h-4 flex-none truncate text-micro text-ink3" aria-live="polite" title="Drag event times or numeric rule handles. Shift-drag selects a range.">{hint ?? (rangeMode ? "Drag to select a range, or enter its start and end."
          : "Bands: hard limits · Diamonds: targets")}</p>
      </div>}
    </section>
  );
}
