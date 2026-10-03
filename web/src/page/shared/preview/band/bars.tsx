"use client";

import { useState } from "react";
import { channelWords, held } from "@/model/observation";
import { displayOrder, narrowNames, type Signal } from "@/model/gnss";
import { fixed } from "@/core";
import { useSize } from "@/page/shared/ui";
import "./bars.css";
import { satWords, type Sat, type Sky } from "./sky";

export function Bars({
  sky,
  pick,
  picked,
  pointed,
  onPick,
  onPoint,
  slim,
  spacious = false,
}: {
  sky: Sky;
  pick: "command" | "inspect" | null;
  picked: (x: Sat, signal?: Signal) => boolean;
  pointed: string | null;
  onPick(x: Sat, signal?: Signal): void;
  onPoint(name: string | null): void;
  slim: boolean;
  spacious?: boolean;
}) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const boxWidth = useSize(box).width;
  const groups = displayOrder
    .map((system) => ({
      system,
      sats: sky.sats
        .filter((x) => x.system === system && x.record && (x.held || x.el >= sky.mask))
        .toSorted((a, b) => a.svid - b.svid),
    }))
    .filter((g) => g.sats.length > 0);
  const bars = groups.reduce((n, g) => n + g.sats.reduce((m, x) => m + x.signals.length, 0), 0);
  const sats = groups.reduce((n, g) => n + g.sats.length, 0);
  const gaps = (groups.length - 1) * (slim ? 8 : 12) + (sats - groups.length) * 2;
  const maxPitch = spacious ? 44 : 31;
  const pitch = boxWidth === 0 ? maxPitch : Math.max(3, Math.min(maxPitch, Math.floor((boxWidth - 24 - gaps) / Math.max(1, bars))));
  const values = pitch >= (spacious ? 34 : 27);
  const width = spacious && pitch >= 28 ? 22 : pitch >= 18 ? 14 : pitch >= 12 ? 10 : Math.max(2, pitch - 1);
  const names = pitch >= 20 ? "flat" : pitch >= 11 ? "tall" : "none";
  const scale = (v: number) => Math.min(100, Math.max(3, ((v - 25) / 30) * 100));
  return (
    <div ref={setBox} className={`meter ${spacious ? "spacious" : ""} relative flex min-w-0 items-start overflow-hidden pl-6 ${slim ? "gap-x-2" : "gap-x-3"}`} onPointerLeave={() => onPoint(null)}>
      {spacious ? [50, 40, 30].map((value, index) => <span key={value} aria-hidden="true" className="absolute left-0 w-[18px] text-right font-mono text-micro leading-4 text-ink3" style={{ top: 40 + index * 48 }}>{value}</span>) : <span aria-hidden="true" className="absolute top-6 left-0 w-[18px] text-right font-mono text-tiny leading-4 whitespace-pre text-ink3">
        {"50\n40\n30"}
      </span>}
      {groups.map((g) => {
        const reasons = [...new Set(g.sats.flatMap((x) => x.signals.map((s) => s.channel)))];
        const none = !reasons.includes(held);
        const why = none ? (reasons.length === 1 ? channelWords[reasons[0] ?? "below_mask"] : "no channel") : "";
        const multi = (g.sats[0]?.signals.length ?? 0) > 1;
        return (
          <div key={g.system} className="flex flex-none flex-col">
            <div className="lab w-0 overflow-visible leading-3 whitespace-nowrap text-ink2" title={`${g.system}${none ? ` · ${why}` : ""}`}>
              {slim ? narrowNames[g.system] : g.system}
              {none ? <span className="font-sans text-micro font-normal tracking-normal text-ink3 normal-case"> · {why}</span> : null}
            </div>
            <div className="flex items-start gap-0.5">
              {g.sats.map((x) => {
                const lit = pointed === x.name;
                const isPicked = picked(x);
                const commanded = x.cmd;
                return (
                  <div key={x.name} className="flex flex-col items-center" onPointerEnter={() => onPoint(x.name)}>
                    <div className="flex">
                      {x.signals.map((s) => {
                        const on = s.channel === held;
                        const mark = s.commanded && on;
                        const signalPicked = picked(x, s.signal);
                        const words = on ? `${satWords(x)} ${s.signal} ${fixed(s.cn0, 1)} dB-Hz${mark ? ", commanded" : ""}` : `${satWords(x)} ${s.signal} · no channel · ${channelWords[s.channel]}`;
                        const body = (
                          <>
                            <span className={`fn ${spacious ? "text-small" : "text-micro"} leading-3 whitespace-nowrap ${values && (spacious || mark || isPicked || lit) ? "visible" : "invisible"} ${mark ? "bg-ink px-0.5 font-medium text-display" : on ? "text-ink2" : "text-ink3"}`}>
                              {on ? fixed(s.cn0, 1) : "–"}
                            </span>
                            <span
                              className={`relative block ${spacious ? "h-36" : "h-12"} ${on ? "" : "border border-b-0 border-dashed border-ink4"} ${signalPicked ? "shadow-[0_0_0_2px_var(--ink)]" : lit ? "shadow-[0_0_0_1px_var(--ink)]" : ""}`}
                              style={{ width }}
                            >
                              {on ? <i className={`absolute right-0 bottom-0 left-0 ${mark ? "bg-ink" : "bg-ink3"}`} style={{ height: `${scale(s.cn0).toFixed(1)}%` }} /> : null}
                            </span>
                            {multi && values ? <span className="fn text-tiny whitespace-nowrap text-ink3">{s.signal}</span> : null}
                          </>
                        );
                        const common = "flex flex-col items-center border-0 bg-transparent p-0 text-inherit";
                        return pick === "inspect" || pick === "command" && on ? (
                          <button
                            key={s.signal}
                            type="button"
                            style={{ width: pitch }}
                            className={`${common} cursor-pointer`}
                            title={words}
                            aria-label={`${words}: ${pick === "inspect" ? "inspect signal" : "fill the command form"}`}
                            aria-pressed={signalPicked}
                            onFocus={() => onPoint(x.name)}
                            onBlur={() => onPoint(null)}
                            onClick={() => onPick(x, s.signal)}
                          >
                            {body}
                          </button>
                        ) : (
                          <div key={s.signal} style={{ width: pitch }} className={common} title={words}>
                            {body}
                          </div>
                        );
                      })}
                    </div>
                    {names === "none" ? null : (
                      <span
                        className={`fn px-px leading-4 whitespace-nowrap ${names === "tall" ? "rotate-180 text-tiny leading-[10px] [writing-mode:vertical-rl]" : spacious && values ? "text-small" : values ? "text-micro" : "text-tiny"} ${isPicked ? "bg-sel text-on-sel" : commanded || lit ? "font-medium text-ink" : x.held ? "text-ink2" : "text-ink3"}`}
                      >
                        {x.name}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
