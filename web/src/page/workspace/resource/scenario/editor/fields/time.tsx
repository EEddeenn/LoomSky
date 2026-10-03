"use client";

import { changeTimeScale } from "@/workbench/documents/scenario/editing";
import { runDocumentEdit } from "@/workbench/documents/editing";
import { gpsOfTime, timeTypes, type TimeType } from "@/model/gnss";
import { recordOf } from "@/core";
import type { Path } from "@/model/schema";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import { Field, Messages, NumberField, Select } from "@/page/shared/documents/editor";
import { diagnosticsAt, pathKey } from "@/model/document";

export function TimeField({ doc, path, label, hint }: { doc: ScenarioDoc; path: Path; label: string; hint?: string }) {
  const raw = recordOf(doc.editor.value(path));
  const type = typeof raw?.type === "string" ? raw.type : "";
  const fields = type === "UTC" ? ["year", "month", "day", "hour", "minute", "second"]
    : type === "GLONASS" ? ["leapYear", "day", "second"]
    : timeTypes.includes(type as TimeType) ? ["week", "second"]
    : [];
  const gps = raw === undefined ? null : gpsOfTime(raw, doc.draftLeap());
  const window = doc.window();
  return (
    <Field label={label} path={pathKey(doc.kind, path)}>
      <div className="@container flex min-w-0 flex-col gap-2">
        <Select
          aria-label={`${label} time scale`}
          title={hint}
          className="w-28 flex-none"
          value={type}
          onChange={(event) => {
            const next = timeTypes.find((t) => t === event.target.value);
            if (next !== undefined) runDocumentEdit({ kind: "scenario", id: doc.id }, () => changeTimeScale(doc, path, next));
          }}
        >
          {!timeTypes.includes(type as TimeType) ? <option value={type}>{type || "Choose scale"}</option> : null}
          {timeTypes.map((scale) => <option key={scale}>{scale}</option>)}
        </Select>
        <div className={`grid min-w-0 gap-2 ${fields.length > 3 ? "grid-cols-2 @min-[300px]:grid-cols-3" : "grid-cols-1 @min-[260px]:grid-cols-2"}`}>
          {fields.map((key) => <NumberField key={key} doc={doc.editor} path={[...path, key]} label={key === "leapYear" ? "N4" : key} />)}
        </div>
      </div>
      {gps !== null && window !== null ? (
        <span className="fn text-small text-ink3" title="Time from scenario start">T{((gps - window.startGpsMs) / 1000).toLocaleString(undefined, { maximumFractionDigits: 6, signDisplay: "always" })} s</span>
      ) : null}
      <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, path, "self")} />
    </Field>
  );
}

export function IntervalFields({ doc, path }: { doc: ScenarioDoc; path: Path }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <TimeField doc={doc} path={[...path, "from"]} label="From (inclusive)" />
      <TimeField doc={doc} path={[...path, "until"]} label="Until (exclusive)" />
    </div>
  );
}
