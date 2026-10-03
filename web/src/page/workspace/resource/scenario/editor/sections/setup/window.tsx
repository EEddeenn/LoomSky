"use client";

import { gpsClock, gpsDate, gpsNow, gpsOfScale, gpsOfTime, scaleMs, timeOf, timeTypes, typeOf, utcClock, type TimeType } from "@/model/gnss";
import { recordOf, stamp, trimmed } from "@/core";
import { scenarioIssues, timeChanges } from "@/model/scenario";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import { schemas } from "@/workbench/schemas";
import { openProblems } from "@/workbench/feedback";
import { Button, FeedbackIcon, Fig } from "@/page/shared/ui";
import { DraftInput, Field, markOf, Messages, NumberField, Select } from "@/page/shared/documents/editor";
import { diagnosticsAt } from "@/model/document";
import { Readout } from "../parts";
import { changeDocument } from "@/workbench/documents/editing";
import { changeTimeScale } from "@/workbench/documents/scenario/editing";
import { runDocumentEdit } from "@/workbench/documents/editing";

export function WindowSection({ doc }: { doc: ScenarioDoc }) {
  const time = recordOf(doc.editor.value(["time"]));
  const type = typeOf(time);
  const w = doc.window();
  const leap = w?.leap ?? doc.draftLeap();
  const start = time === undefined ? null : gpsOfTime(time, leap);
  const text = start === null ? "" : stamp(scaleMs(type, start, leap));
  const coverageIssue = scenarioIssues(doc, schemas.get().scenario).find((issue) => issue.kind === "navigation-coverage");
  const writeTime = (t: TimeType, gps: number) => changeDocument(doc, () =>
    doc.editor.writeMany(timeChanges(["time"], timeOf(t, gps, doc.draftLeap()))),
  );
  const diagnostics = diagnosticsAt(doc.editor, ["time"]);
  return (
    <>
      <Field label="Start" htmlFor="window-start" path="scenario:time">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5 @min-[500px]:grid-cols-[minmax(0,1fr)_88px_auto]">
          <DraftInput
            key={type}
            doc={doc.editor}
            path={["time"]}
            id="window-start"
            mark={markOf(diagnostics)}
            value={text}
            codec={{ kind: "time", type, leap }}
            error="Enter a valid date: YYYY-MM-DD HH:MM:SS."
            className="col-span-full @min-[500px]:col-span-1"
          />
          <Select
            aria-label="Time type"
            value={type}
            onChange={(e) => {
              const next = timeTypes.find((t) => t === e.target.value);
              if (next !== undefined) runDocumentEdit({ kind: "scenario", id: doc.id }, () => changeTimeScale(doc, ["time"], next));
            }}
          >
            {timeTypes.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
          <Button
            onClick={() => {
              const next = Math.floor(scaleMs(type, gpsNow(leap) + 60_000, leap) / 60_000) * 60_000;
              writeTime(type, gpsOfScale(type, next, leap));
            }}
          >
            Now
          </Button>
        </div>
        <Messages doc={doc.editor} diagnostics={diagnostics} />
      </Field>
      <NumberField
        doc={doc.editor}
        path={["duration"]}
        label="Duration"
        placeholder="Whole trajectory"
        hint={doc.view?.shape == null ? undefined : <Fig>{`Trajectory: ${trimmed(doc.view.shape.duration)} s`}</Fig>}
      />
      {w !== null ? (
        <Readout>
          <b className="font-medium text-ink">
            <Fig>{`${gpsDate(w.startGpsMs)} ${gpsClock(w.startGpsMs)} → ${gpsClock(w.startGpsMs + w.durationMs)} GPS`}</Fig>
          </b>
          <span>
            <Fig>{`${utcClock(w.startGpsMs, w.leap)} → ${utcClock(w.startGpsMs + w.durationMs, w.leap)} UTC`}</Fig>
          </span>
          {w.leap.change !== null ? <Fig>{`GPS − UTC ${w.leap.seconds} s, ${w.leap.after} s from ${gpsClock(w.leap.change)} GPS`}</Fig> : null}
        </Readout>
      ) : null}
      {coverageIssue !== undefined ? (
        <div className="flex flex-wrap items-center gap-2 text-small">
          <button type="button" className="inline-flex items-center gap-1 text-warn-ink" onClick={() => openProblems(coverageIssue.id)}>
            <FeedbackIcon level="warning" size={14} />
            <span className="underline underline-offset-3">Coverage issue</span>
          </button>
          <Button
            size="xs"
            disabled={coverageIssue.coverage.moveTo === null}
            onClick={() => {
              if (coverageIssue.coverage.moveTo !== null) writeTime(type, coverageIssue.coverage.moveTo);
            }}
          >
            Move into coverage
          </Button>
        </div>
      ) : null}
    </>
  );
}
