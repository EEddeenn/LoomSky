"use client";

import { channelWords, held, type Channel } from "@/model/observation";
import { satelliteName, type Signal, type System } from "@/model/gnss";
import type { TruthEpoch } from "@/model/observation";
import "./sky.css";

export type Sat = {
  system: System;
  svid: number;
  name: string;
  record: boolean;
  above: boolean;
  az: number;
  el: number;
  held: boolean;
  cmd: boolean;
  reason: Channel;
  masked: boolean;
  signals: { signal: Signal; channel: Channel; cn0: number; commanded: boolean }[];
};

export type Sky = { sats: Sat[]; mask: number; geo: boolean; dop: { p: number; h: number; v: number } | null };

export function skyOf(truth: TruthEpoch, geo: boolean): Sky {
  const sats = truth.satellites.map((s): Sat => {
    const system = s.system;
    const sigs = truth.signals
      .filter((g) => g.system === s.system && g.svid === s.svid)
      .map((g) => ({ signal: g.signal, channel: g.channel, cn0: g.cn0, commanded: g.commanded }));
    const on = sigs.some((g) => g.channel === held);
    return {
      system,
      svid: s.svid,
      name: satelliteName(system, s.svid),
      record: s.record,
      above: s.aboveMask,
      az: s.azimuth,
      el: s.elevation,
      held: on,
      cmd: sigs.some((g) => g.commanded && g.channel === held),
      reason: sigs.find((g) => g.channel !== held)?.channel ?? "below_mask",
      masked: s.maskedOut,
      signals: sigs,
    };
  });
  const dop = truth.pdop > 0 ? { p: truth.pdop, h: truth.hdop, v: truth.vdop } : null;
  return { sats, mask: truth.mask, geo, dop };
}

function onWord(live: boolean): string {
  return live ? "on air" : "with a channel";
}

function dotClass(x: Sat, sky: Sky): string {
  if (sky.geo) return x.above ? "up" : "dn";
  if (x.held) return x.cmd ? "cmd" : "on";
  return x.el >= sky.mask ? "up" : "dn";
}

function channelText(x: Sat, sky: Sky, live: boolean): string {
  if (sky.geo) return `${x.above ? "above" : "below"} the mask${x.masked ? " · masked out" : ""}`;
  if (x.held) return `${onWord(live)}${x.el < sky.mask ? ", held below the mask" : ""}`;
  return `no channel · ${channelWords[x.reason]}`;
}

export function satWords(x: Sat): string {
  return `${x.system} ${x.svid}`;
}

export type Count = [value: number, label: string, dot: string];

export function skyCounts(sky: Sky, live: boolean): { main: Count; rest: Count[] } {
  const n = (f: (x: Sat) => boolean) => sky.sats.filter(f).length;
  const main: Count = sky.geo ? [n((x) => x.above && !x.masked), "above the mask", "up"] : [n((x) => x.held), onWord(live), "on"];
  const rest: Count[] = sky.geo
    ? [
        [n((x) => x.masked), "masked out", ""],
        [n((x) => x.record && !x.above), "below", "dn"],
      ]
    : [
        [n((x) => x.record && !x.held && x.el >= sky.mask), "no channel", "up"],
        [n((x) => x.record && !x.held && x.el < sky.mask), "below", "dn"],
      ];
  const unrecorded: Count = [n((x) => !x.record), "no record", ""];
  return { main, rest: [...rest, unrecorded].filter(([value]) => value > 0) };
}

const radius = 58;
const cx = 68;
const cy = 66;
const r = (el: number) => (radius * (90 - Math.max(0, el))) / 90;

export function SkyPlot({
  sky,
  live,
  pick,
  picked,
  pointed,
  onPick,
  onPoint,
  mood,
  size,
}: {
  sky: Sky;
  live: boolean;
  pick: "command" | "inspect" | null;
  picked: (x: Sat) => boolean;
  pointed: string | null;
  onPick(x: Sat): void;
  onPoint(name: string | null): void;
  mood: "" | "stale" | "frozen";
  size: number;
}) {
  const counts = skyCounts(sky, live);
  const ticks = [];
  for (let i = 0; i < 36; i++) {
    if (i % 9 === 0) continue;
    const a = (i * 10 * Math.PI) / 180;
    const major = i % 3 === 0;
    const r1 = radius - (major ? 5 : 3);
    ticks.push(
      <line key={i} className={`tk${major ? "" : " mi"}`} x1={cx + radius * Math.sin(a)} y1={cy - radius * Math.cos(a)} x2={cx + r1 * Math.sin(a)} y2={cy - r1 * Math.cos(a)} />,
    );
  }
  const shown = sky.sats.filter((x) => x.record && x.el > -2).sort((a, b) => Number(a.held) - Number(b.held));
  return (
    <svg
      className={`sky block overflow-visible ${mood}`}
      viewBox="-6 -8 148 150"
      style={{ width: size, height: size + 2 }}
      role={pick === null ? "img" : "group"}
      aria-label={`Sky plot: ${[counts.main, ...counts.rest].map(([value, label]) => `${value} ${label}`).join(", ")}; mask ${Math.round(sky.mask)}°`}
      onPointerLeave={() => onPoint(null)}
    >
      <circle className="ring0" cx={cx} cy={cy} r={radius} />
      <circle className="ring" cx={cx} cy={cy} r={r(30)} />
      <circle className="ring" cx={cx} cy={cy} r={r(60)} />
      <line className="ring" x1={cx} y1={cy - radius} x2={cx} y2={cy + radius} />
      <line className="ring" x1={cx - radius} y1={cy} x2={cx + radius} y2={cy} />
      <circle className="maskring" cx={cx} cy={cy} r={r(sky.mask)} />
      {ticks}
      <text className="ax" x={cx} y={cy - radius - 4} textAnchor="middle">
        N
      </text>
      <text className="ax" x={cx + radius + 4} y={cy + 3.5}>
        E
      </text>
      <text className="ax" x={cx} y={cy + radius + 11} textAnchor="middle">
        S
      </text>
      <text className="ax" x={cx - radius - 4} y={cy + 3.5} textAnchor="end">
        W
      </text>
      {shown.map((x) => {
        const rr = r(x.el);
        const X = cx + rr * Math.sin((x.az * Math.PI) / 180);
        const Y = cy - rr * Math.cos((x.az * Math.PI) / 180);
        const k = dotClass(x, sky);
        const can = pick === "inspect" || pick === "command" && x.held;
        const lit = pointed === x.name;
        const words = `${satWords(x)} · ${channelText(x, sky, live)} · azimuth ${Math.round(x.az)}° · elevation ${Math.round(x.el)}°`;
        return (
          <g key={x.name}>
            {k === "cmd" ? <circle className="cmdr" cx={X} cy={Y} r={6} /> : null}
            <circle
              className={`${k}${can ? " pick" : ""}${lit || picked(x) ? " hl" : ""}`}
              role={can ? "button" : undefined}
              tabIndex={can ? 0 : undefined}
              aria-label={can ? `${words}: ${pick === "inspect" ? "inspect satellite" : "fill the command form"}` : undefined}
              aria-pressed={can ? picked(x) : undefined}
              cx={X}
              cy={Y}
              r={x.held ? 3.6 : 3.2}
              onPointerEnter={() => onPoint(x.name)}
              onFocus={() => onPoint(x.name)}
              onBlur={() => onPoint(null)}
              onClick={can ? () => onPick(x) : undefined}
              onKeyDown={can ? (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onPick(x);
              } : undefined}
            >
              <title>{words}</title>
            </circle>
            <text className={`sv${k === "cmd" || picked(x) ? " keep" : ""}${lit ? " hl" : ""}`} x={X + 5} y={Y + 3}>
              {x.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
