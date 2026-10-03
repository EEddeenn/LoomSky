"use client";

import type { ReactNode } from "react";
import { ageText, armedWord, canStop, hostNow, nameOf, onAirSeen, offGlyph, offWord, radioWord, rfBound, sourceWords, stopText, type Host } from "@/workbench/hosts";
import { stopHost } from "@/workbench/hosts/actions";
import { gpsClock, gpsOfUnix, utcClock, type Leap } from "@/model/gnss";
import { mmss, useStore } from "@/core";
import { scenarioCatalog } from "@/workbench/documents/scenario";
import { openProblems } from "@/workbench/feedback";
import { openTransmit } from "@/workbench/transmit";
import { Button, Fig, GpsTime, Icon } from "@/page/shared/ui";
import type { HostDisplay } from "@/page/workspace/resource/host";

function StopKey({ host, onAir }: { host: Host; onAir: boolean }) {
  const name = nameOf(host);
  return (
    <button
      type="button"
      aria-label={`Stop ${name}`}
      onClick={() => stopHost(host.key)}
      className={`ml-auto inline-flex h-9 min-w-0 max-w-full items-center gap-2 rounded-key px-3 font-semibold whitespace-nowrap ${onAir ? "bg-[#ffffff] text-[#141414] hover:bg-[#f0f0f0]" : "bg-face text-ink ring-key hover:bg-hover"}`}
    >
      <span className={`shrink-0 ${onAir ? "text-[#c8251b]" : "text-rf-mark"}`}><Icon name="stop" size={12} /></span>
      <span className="flex min-w-0 items-center gap-1">
        <span className="shrink-0">Stop</span>
        <span className="truncate">{name}</span>
      </span>
    </button>
  );
}

function Clock({ gps, leap, tenths }: { gps: number; leap: Leap; tenths: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="fn text-d1 font-medium tracking-[-0.01em]">{gpsClock(gps, tenths)}</span>
      <span className="font-cond text-small font-semibold tracking-[0.08em]">GPS</span>
      <small className="ml-2 text-body">
        <span className="fn">{utcClock(gps, leap, tenths)}</span> <span className="font-cond text-label font-semibold tracking-[0.08em]">UTC</span>
      </small>
    </div>
  );
}

export function Tally({ host, now, view }: HostDisplay) {
  const scenarios = useStore(scenarioCatalog, (state) => state.order.length);
  const { cls, status, window, leap, epoch, refusal } = view;
  const stopping = stopText(host);
  const off = offWord(host);
  const word = cls === "onair" ? `On air${status?.config.replay_ms != null ? " · Replay" : ""}`
    : cls === "armed" ? armedWord(host) : cls === "unknown" ? "Unknown"
      : cls === "alarm" ? host.alarm?.kind === "restarted" ? "Restarted" : "Failed" : refusal !== null ? "Refused" : off.word;
  const glyph = cls === "onair" ? <span className="inline-block size-2.5 rounded-full bg-on-rf" />
    : <Icon name={cls === "armed" ? "clock" : cls === "unknown" ? "unknown" : cls === "alarm" ? "alert" : refusal !== null ? "warn" : offGlyph(host)} />;
  const tone = cls === "onair" ? "" : cls === "armed" || cls === "unknown" ? "text-rf-ink" : cls === "alarm" ? "text-fault" : refusal !== null ? "text-warn-ink" : "text-ink2";
  const card = cls === "onair" ? "border-rf bg-rf text-on-rf" : cls === "armed" ? "outline-2 -outline-offset-2 outline-rf-mark"
    : cls === "unknown" ? "outline-2 -outline-offset-2 outline-dashed outline-rf-mark" : cls === "alarm" ? "outline-2 -outline-offset-2 outline-fault" : "";
  let content: ReactNode;
  let problem: string | null = null;
  let transmit: "primary" | "default" | null = null;
  if (cls === "onair" && window !== null) {
    const sent = epoch ?? 0;
    const step = [60, 120, 300, 600, 900, 1800, 3600].find((x) => window.durationMs / 1000 / x <= 40) ?? 7200;
    const tick = ((step * 1000) / window.durationMs) * 100;
    content = <>
      <Clock gps={window.startGpsMs + sent} leap={leap} tenths />
      <div className="relative h-2 overflow-hidden bg-[rgba(255,255,255,0.3)]" role="img" aria-label={`${mmss(sent)} of ${mmss(window.durationMs)}`}>
        <i className="block h-full bg-on-rf" style={{ width: `${(sent / window.durationMs) * 100}%` }} />
        <span className="absolute inset-0" style={{ background: `repeating-linear-gradient(90deg, transparent 0 calc(${tick}% - 2px), var(--rf) calc(${tick}% - 2px) ${tick}%)` }} />
      </div>
      <div className="leading-5"><Fig>{`${mmss(window.durationMs - sent)} left${stopping === "" ? "" : ` · ${stopping}`}`}</Fig></div>
    </>;
  } else if (cls === "armed") {
    const start = window?.startGpsMs ?? null;
    const gpsNow = gpsOfUnix(hostNow(host, now), leap);
    const sent = word === "Recovering" ? epoch : null;
    content = <>
      {sent !== null && start !== null ? <div>
        <div className="lab text-small text-ink2">Last reported sent</div>
        <Clock gps={start + sent} leap={leap} tenths={false} />
      </div> : <div className="fn text-d1 font-medium">{host.upload !== null ? `${Math.floor(host.upload.share * 100)} %` : word === "Waiting" && start !== null ? mmss(start - gpsNow) : ""}</div>}
      <div className="leading-5">
        {host.upload !== null ? sourceWords(host.upload.source) : word === "Waiting" && start !== null
          ? <Fig>{`Starts at ${gpsClock(start)} GPS · ${utcClock(start, leap)} UTC`}</Fig>
          : word === "Recovering" ? "Preparing next burst" : "Preparing radio"}
        {stopping === "" ? "" : ` · ${stopping}`}
      </div>
    </>;
  } else if (cls === "unknown") {
    const bound = rfBound(host);
    const lastGps = window === null || epoch === null ? (host.record.seen?.sentGps ?? null) : window.startGpsMs + epoch;
    const replay = status !== null ? status.config.replay_ms !== null : (host.record.seen?.replay ?? false);
    problem = host.recovery === "loading" ? null : "unknown";
    content = <>
      {host.recovery === "loading" ? <div className="leading-5">Loading saved submissions…</div> : null}
      {lastGps === null ? null : <div className="leading-5">
        Last seen <b className="font-semibold">{onAirSeen(host) ? "on air" : "armed"}</b> at <GpsTime gps={lastGps} leap={leap} />{replay ? " · Replay" : ""}
      </div>}
      {bound === null ? null : <div className="leading-5">RF at most until <b className="font-semibold"><GpsTime gps={bound} leap={leap} /></b></div>}
      {host.stop?.queued === true ? <div className="leading-5">{stopping}</div> : null}
    </>;
  } else if (cls === "alarm" && host.alarm !== null) {
    problem = "alarm";
    content = <>
      <div className="text-d2 font-semibold"><Fig>{`Run ${host.alarm.run} ended`}</Fig></div>
      {host.alarm.lastGps === null ? null : <div className="leading-5">Last seen on air at <GpsTime gps={host.alarm.lastGps} leap={leap} /></div>}
    </>;
  } else if (cls === "off" && refusal !== null) {
    problem = "refused";
    content = <div className="text-d2 font-semibold">Nothing was transmitted</div>;
  } else if (host.link !== "ok" && host.link !== "none") {
    problem = "connection";
    content = <div className="flex items-baseline gap-2 text-d2 font-semibold">
      <span className="fn font-medium">{ageText(host, now)}</span>
      <small className="text-body font-normal">without status</small>
    </div>;
  } else if (status?.state === "ended" && window !== null) {
    const last = status.sent;
    transmit = "default";
    content = <>
      {last === null ? <div className="text-d2 font-semibold">Nothing was transmitted</div> : <Clock gps={window.startGpsMs + last} leap={leap} tenths={false} />}
      {last === null ? null : <div className="leading-5"><Fig>{`${mmss(last - (status.first ?? 0))} / ${mmss(window.durationMs)} aired`}</Fig></div>}
    </>;
  } else {
    transmit = "primary";
    content = <div className="leading-5 first-letter:uppercase">{radioWord(host)}</div>;
  }
  return (
    <div className={`relative flex flex-col gap-2 border-b border-line2 px-4 py-3 ${card}`}>
      <div className="flex min-h-9 items-center gap-2">
        <span className={`shrink-0 ${tone}`}>{glyph}</span>
        <span role="status" className={`shrink-0 ${cls !== "off" || refusal !== null ? "lab text-small" : "text-body"} ${tone}`}>
          {word}{stopping === "" ? null : <span className="vh">{`. ${stopping}`}</span>}
        </span>
        {canStop(host, now) ? <StopKey host={host} onAir={cls === "onair"} /> : null}
      </div>
      {content}
      {problem === null ? null : <Button size="sm" className="self-start" onClick={() => openProblems(`host:${host.key}:${problem}`)}>Details</Button>}
      {transmit === null ? null : <Button size="sm" variant={transmit} icon={transmit === "primary" ? "send" : undefined} className="mt-1 self-start" disabled={transmit === "primary" && scenarios === 0} onClick={() => openTransmit({ host: host.key })}>
        Transmit…
      </Button>}
    </div>
  );
}
