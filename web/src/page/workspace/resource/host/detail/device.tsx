"use client";

import { age } from "@/core";
import { bands } from "@/model/gnss";
import { openProblems } from "@/workbench/feedback";
import { ageText, nameOf, radioWord } from "@/workbench/hosts";
import { retry } from "@/workbench/hosts/actions";
import { Button, Fig } from "@/page/shared/ui";
import type { HostDisplay } from "../display";
import { ScrollArea } from "../scroll";
import { DetailSection, Pairs } from "./section";
import { Settings } from "./device/settings";

const references: Record<string, string> = { none: "Free-running", gpsdo: "GPSDO", external: "External" };

export function DeviceTab({ host, now, view }: HostDisplay) {
  const station = view.snapshot?.station;
  return (
    <ScrollArea pane="device">
      <div className="max-w-4xl">
        <DetailSection title="Connection">
          <Pairs rows={[
            ["Address", <code key="address" className="text-small">{host.record.address}</code>],
            ["Name", nameOf(host)],
            ["Connection", host.link === "ok" ? "Connected" : host.link === "none" ? "Waiting for status" : host.link === "token" ? "Token refused" : host.link === "origin" ? "Origin not allowed" : "No status response"],
            ["Last status", host.lastOkAt === null ? "Not received" : <Fig key="last">{`${age(Math.max(100, now - host.lastOkAt))} ago`}</Fig>],
            ["Boot identity", view.snapshot === null ? null : <code key="boot" className="text-small">{view.snapshot.boot}</code>],
            ["Clock", host.offsetMs === null ? "Unavailable" : <Fig key="clock">{`${host.offsetMs >= 0 ? "+" : "−"}${(Math.abs(host.offsetMs) / 1000).toFixed(2)} s vs this computer`}</Fig>],
          ]} />
          {host.link !== "ok" && host.link !== "none" && (host.recovery !== "loading" || host.record.seen?.live === true) ? (
            <Button size="xs" variant="ghost" className="self-start" onClick={() => openProblems(`host:${host.key}:${view.cls === "unknown" ? "unknown" : "connection"}`)}>Details</Button>
          ) : null}
          <Button size="sm" className="self-start" onClick={() => retry(host.key)}>Retry connection</Button>
        </DetailSection>
        <DetailSection title="Capabilities">
          {station === undefined ? <p className="m-0 text-small text-ink3">Waiting for device info…</p> : <Pairs rows={[
            ["Radio", radioWord(host).replace(/^radio /, "")],
            ["Bands", <Fig key="bands">{bands(station.bands_hz)}</Fig>],
            ["Maximum gain", <Fig key="gain">{`${station.max_gain_db} dB`}</Fig>],
            ["Reference", references[station.reference] ?? station.reference],
            ["Saved gain", host.record.gain === null ? "Not set" : <Fig key="saved-gain">{`${host.record.gain} dB`}</Fig>],
          ]} />}
          {host.link !== "ok" && station !== undefined ? <p className="m-0 text-small text-ink3">Last known capabilities · no status for {ageText(host, now)}.</p> : null}
        </DetailSection>
        <Settings host={host} />
      </div>
    </ScrollArea>
  );
}
