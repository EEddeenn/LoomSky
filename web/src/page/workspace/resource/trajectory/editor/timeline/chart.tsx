import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { trimmed } from "@/core";
import { clamp, plotPath, timeX, valueY, type PlotBounds, type PlotSample } from "./plot";

export type RuleValue = { field: "eq" | "value" | "min" | "max"; value: number };
export type RuleMark = {
  id: string;
  label: string;
  kind: "hard" | "target";
  from: number;
  to: number;
  values: RuleValue[];
};
export type NumericHandle = { mark: RuleMark; numeric: RuleValue };
export type TimeRange = { from: number; to: number };

type QuantityChartProps = {
  samples: PlotSample[];
  bounds: PlotBounds;
  marks: RuleMark[];
  cursor: number;
  selectedRule: string | null;
  range: TimeRange | null;
  highlight: TimeRange | null;
  unit: string;
  children: ReactNode;
  onSeek(event: PointerEvent<HTMLDivElement>): void;
  onKeyDown(event: KeyboardEvent<HTMLDivElement>): void;

};

export function QuantityChart({ samples, bounds, marks, cursor, selectedRule, range, highlight, unit, children, onSeek, onKeyDown }: QuantityChartProps) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[76px_minmax(0,1fr)] border-t border-line">
      <div className="relative mr-2 text-right font-mono text-micro text-ink3" aria-hidden="true">
        {[bounds.high, (bounds.high + bounds.low) / 2, bounds.low].map((value, index) => (
          <span key={index} className="absolute right-0 -translate-y-1/2" style={{ top: `${valueY(value, bounds)}%` }}>{trimmed(value)} {unit}</span>
        ))}
      </div>
      <div
        role="group"
        tabIndex={0}
        aria-label="Chart time cursor. Arrow keys seek; Shift-drag selects a time range."
        className="relative min-h-20 touch-none overflow-hidden outline-offset-[-2px]"
        onPointerDown={onSeek}
        onKeyDown={onKeyDown}
      >
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
            <path key={fraction} d={`M${10 + fraction * 980} 0 V100`} stroke="var(--line)" vectorEffect="non-scaling-stroke" />
          ))}
          {[6, 50, 94].map((y) => <path key={y} d={`M10 ${y} H990`} stroke="var(--line)" vectorEffect="non-scaling-stroke" />)}
          {marks.map((mark) => {
            const left = timeX(mark.from, bounds.duration) * 10;
            const width = Math.max(1, (timeX(mark.to, bounds.duration) - timeX(mark.from, bounds.duration)) * 10);
            const minimum = mark.values.find((value) => value.field === "min")?.value;
            const maximum = mark.values.find((value) => value.field === "max")?.value;
            const upper = maximum === undefined ? 0 : clamp(valueY(maximum, bounds), 0, 100);
            const lower = minimum === undefined ? 100 : clamp(valueY(minimum, bounds), 0, 100);
            return (
              <g key={mark.id}>
                {mark.kind === "hard" && (minimum !== undefined || maximum !== undefined) ? (
                  <rect x={left} y={upper} width={width} height={Math.max(0, lower - upper)} fill="var(--ink3)" opacity={mark.id === selectedRule ? 0.17 : 0.08} />
                ) : null}
                {mark.values.map(({ field, value }) => (
                  <path
                    key={field}
                    d={`M${left} ${valueY(value, bounds)} h${width}`}
                    stroke={mark.id === selectedRule ? "var(--ink)" : "var(--ink3)"}
                    strokeDasharray={mark.kind === "target" ? "3 4" : "7 3"}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </g>
            );
          })}
          {range === null ? null : <rect x={timeX(range.from, bounds.duration) * 10} y={0} width={Math.max(0, (timeX(range.to, bounds.duration) - timeX(range.from, bounds.duration)) * 10)} height={100} fill="var(--ink)" opacity={0.1} />}
          {highlight === null ? null : <rect x={timeX(highlight.from, bounds.duration) * 10} y={0} width={Math.max(1, (timeX(highlight.to, bounds.duration) - timeX(highlight.from, bounds.duration)) * 10)} height={100} fill="var(--ink3)" opacity={0.09} />}
          <path d={plotPath(samples, bounds)} fill="none" stroke="var(--ink)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </svg>
        {samples.length === 0 ? <span className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-small text-ink3">No solved samples</span> : null}
        <span className="pointer-events-none absolute inset-y-0 z-10 border-l border-ink" style={{ left: `${timeX(cursor, bounds.duration)}%` }} />
        {children}
      </div>
    </div>
  );
}
