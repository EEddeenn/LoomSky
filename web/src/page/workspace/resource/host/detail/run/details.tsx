"use client";

import { sourceWords } from "@/workbench/hosts";
import type { HostDisplay } from "@/page/workspace/resource/host";
import { duration, fixed, group, offset, useStore } from "@/core";
import { gpsClock, gpsDate } from "@/model/gnss";
import { scenarioCatalog } from "@/workbench/documents/scenario";
import { page, setRows } from "@/workbench/navigation";
import { openProblems } from "@/workbench/feedback";
import { NavLink } from "@/page/shared/navigation";
import { Button, Fig, GpsTime } from "@/page/shared/ui";
import { DetailSection, Pairs } from "../section";
import { SubmissionSnapshot } from "../snapshot";

export function RunDetails({ host, view }: HostDisplay) {
  const catalog = useStore(scenarioCatalog, (s) => s);
  const { snapshot, status, submission: sub, window, leap, cls, refusal } = view;
  const scenario = sub === null ? undefined : catalog.entries.get(sub.source.scenarioId);
  const snapshotKey = `host:${host.key}:snapshot`;
  const snapshotOpen = useStore(page, (s) => s.rows[snapshotKey] === true);
  if (snapshot === null || status === null) {
    return <DetailSection title="Current run"><p className="m-0 text-ink2">No run reported.</p></DetailSection>;
  }
  const outcome = status.outcome;
  const markers = host.faultRun === `${snapshot.boot}|${snapshot.run}` ? host.faults : [];
  const faults = Object.entries(status.counts).filter(([, count]) => count > 0);
  return (
    <>
      <DetailSection title={`Run ${snapshot.run}`}>
        <Pairs rows={[
          [
            "Run snapshot",
            sub === null ? (
              <span>{status.config.label || "Unknown configuration"} <span className="text-ink3">· source unavailable locally</span></span>
            ) : (
              <span className="font-medium">{sourceWords(sub.source)}</span>
            ),
          ],
          [
            "Current scenario",
            scenario === undefined ? null : (
              <span>
                {scenario.head.id} v{scenario.head.headVersionNumber}
                {scenario.head.headVersionId === sub?.source.versionId ? " · Same version" : " · Different version"}
                {scenario.working?.dirty || scenario.working?.pending ? " · Unsaved changes" : ""}
                <NavLink size="xs" variant="ghost" className="ml-3" destination={{ workspace: "resource", kind: "scenario", id: scenario.head.id, tab: "setup" }}>Open scenario</NavLink>
              </span>
            ),
          ],
          ["Mode", status.config.replay_ms === null ? "Live" : <Fig>{`Replay from ${offset(status.config.replay_ms)}`}</Fig>],
          [
            "Window",
            window === null ? null : (
              <span>
                <Fig>{`${gpsDate(window.startGpsMs)} ${gpsClock(window.startGpsMs)} → ${gpsClock(window.startGpsMs + window.durationMs)} GPS`}</Fig>
                <span className="text-ink3"> · {duration(window.durationMs)}</span>
              </span>
            ),
          ],
          ["First sent", status.first === null || window === null ? null : <GpsTime gps={window.startGpsMs + status.first} leap={leap} />],
          [
            "Last reported sent",
            status.sent === null || window === null ? null : (
              <span><GpsTime gps={window.startGpsMs + status.sent} leap={leap} /><span className="text-ink3"> · epoch {group(status.sent)}</span></span>
            ),
          ],
          [
            "Radio readback",
            status.plan === null ? null : <Fig>{`${fixed(status.plan.centre_hz / 1e6, 3)} MHz · ${fixed(status.plan.rate_hz / 1e6, 3)} Msps · ${fixed(status.plan.gain_db, 2)} dB`}</Fig>,
          ],
          ["Outcome", outcome === null ? null : Object.keys(outcome)[0]],
          ["Run identity", <code key="identity" className="text-small">{snapshot.boot} / {snapshot.run}</code>],
        ]} />
        {host.alarm === null && !(refusal !== null && cls === "off") ? null : (
          <Button size="xs" variant="ghost" className="self-start" onClick={() => openProblems(`host:${host.key}:${host.alarm === null ? "refused" : "alarm"}`)}>Details</Button>
        )}
        {sub === null ? (
          <p className="m-0 text-small text-ink3">Status is available; the run snapshot and bundle are not saved in this browser.</p>
        ) : (
          <>
            <Button
              size="sm"
              className="self-start"
              aria-expanded={snapshotOpen}
              onClick={() => setRows(snapshotKey, !snapshotOpen)}
            >
              {snapshotOpen ? "Hide snapshot" : "View snapshot"}
            </Button>
            {snapshotOpen ? <SubmissionSnapshot submission={sub} /> : null}
          </>
        )}
      </DetailSection>
      <DetailSection title="Faults">
        {faults.length === 0 ? <p className="m-0 text-small text-ink2">No faults reported.</p> : faults.map(([kind, count]) => {
          const epoch = markers.find((marker) => marker.kind === kind)?.epoch;
          return (
            <div key={kind} className="flex items-center gap-2 text-ink2">
              <Fig>{`${group(count)} ${kind}`}</Fig>
              {epoch === undefined || window === null ? null : <span className="text-small">· first observed at <GpsTime gps={window.startGpsMs + epoch} leap={leap} /></span>}
            </div>
          );
        })}
        {faults.length === 0 ? null : <Button size="xs" variant="ghost" className="self-start" onClick={() => openProblems(`host:${host.key}:faults:${snapshot.boot}:${snapshot.run}`)}>Details</Button>}
      </DetailSection>
    </>
  );
}
