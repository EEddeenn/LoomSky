"use client";

import { useRef } from "react";

export function ConfigurationSplitter({ width, maximum, onChange }: { width: number; maximum: number; onChange(width: number): void }) {
  const drag = useRef<{ pointer: number; x: number; width: number } | null>(null);
  const change = (value: number) => onChange(Math.round(Math.max(360, Math.min(maximum, value))));
  return (
    <div
      role="separator"
      aria-label="Configuration width"
      aria-controls="scenario-configuration"
      aria-orientation="vertical"
      aria-valuemin={360}
      aria-valuemax={maximum}
      aria-valuenow={width}
      tabIndex={0}
      className="relative z-10 w-1.5 cursor-col-resize touch-none border-x border-line bg-panel hover:bg-line2 focus-visible:bg-line2"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointer: event.pointerId, x: event.clientX, width };
      }}
      onPointerMove={(event) => {
        const active = drag.current;
        if (active?.pointer === event.pointerId) change(active.width + event.clientX - active.x);
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointer !== event.pointerId) return;
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        if (drag.current !== null) change(drag.current.width);
        drag.current = null;
      }}
      onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && drag.current !== null) {
          change(drag.current.width);
          drag.current = null;
        } else if (event.key === "ArrowLeft") change(width - 20);
        else if (event.key === "ArrowRight") change(width + 20);
        else if (event.key === "Home") change(360);
        else if (event.key === "End") change(maximum);
        else return;
        event.preventDefault();
      }}
    />
  );
}
