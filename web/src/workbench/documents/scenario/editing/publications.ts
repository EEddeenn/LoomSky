"use client";

import type { Prepared, WriteChange } from "@/model/document";
import { listOf, recordOf } from "@/core";
import { gpsOfTime, timeOf, type TimeType } from "@/model/gnss";
import type { Path } from "@/model/schema";
import { inavServiceChanges, timeChanges, type PublicationRules } from "@/model/scenario";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import { discardDraftsAt, editDocument } from "../../editing";

type PublicationFamily = "gps" | "inav" | "d2";
export const publicationPaths: Record<PublicationFamily, Path> = { gps: ["messages", "gps"], inav: ["messages", "galileo", "inav"], d2: ["messages", "bds", "d2"] };

export function referenceTime(doc: ScenarioDoc, publication: Path, scale: TimeType, gridMs: number) {
  const window = doc.window();
  const leap = window?.leap ?? doc.draftLeap();
  const from = recordOf(doc.editor.value([...publication, "from"]));
  const time = recordOf(doc.editor.value(["time"]));
  const start = (from === undefined ? null : gpsOfTime(from, leap))
    ?? window?.startGpsMs
    ?? (time === undefined ? null : gpsOfTime(time, leap));
  return start === null ? undefined : timeOf(scale, Math.floor(start / gridMs) * gridMs, leap);
}

export function editPublication(doc: ScenarioDoc, changes: () => readonly WriteChange[]): Prepared<void> {
  return editDocument(doc, () => doc.editor.writeMany(changes()));
}

export function changeInavService(doc: ScenarioDoc, publication: Path, service: string, rules: PublicationRules["inav"]): Prepared<void> {
  return editPublication(doc, () => {
    const path = [...publication, "ism"];
    const current = recordOf(doc.editor.value(path)) ?? {};
    const reference = referenceTime(doc, publication, "Galileo", rules.referenceGridMs);
    return inavServiceChanges(path, current, service, reference);
  });
}

export function changeTimeScale(doc: ScenarioDoc, path: Path, next: TimeType): Prepared<void> {
  return editPublication(doc, () => {
    const current = recordOf(doc.editor.value(path));
    const leap = doc.draftLeap();
    const gps = current === undefined ? null : gpsOfTime(current, leap);
    return timeChanges(path, gps === null ? { type: next } : timeOf(next, gps, leap));
  });
}

function contextInterval(doc: ScenarioDoc, previous?: unknown): { from?: unknown; until?: unknown } {
  const window = doc.window();
  const from = recordOf(previous)?.until ?? doc.editor.value(["time"]);
  const start = gpsOfTime(recordOf(from) ?? {}, doc.draftLeap());
  const end = window === null ? null : window.startGpsMs + window.durationMs;
  return {
    ...(from === undefined ? {} : { from }),
    ...(start === null || end === null || end <= start || window === null ? {} : { until: timeOf("GPS", end, window.leap) }),
  };
}

function selectPublication(doc: ScenarioDoc, family: PublicationFamily, index: number): void {
  doc.editing.selectCollection(publicationPaths[family], index);
}

export function addPublication(doc: ScenarioDoc, family: PublicationFamily): Prepared<void> {
  return editDocument(doc, () => {
    const path = publicationPaths[family];
    const current = listOf(doc.editor.value(path));
    const publication = contextInterval(doc, current.at(-1));
    if (current.length === 0) doc.editor.write(path, [publication]);
    else if (Array.isArray(doc.editor.value(path))) doc.editor.write([...path, current.length], publication, { insert: true });
    else doc.editor.writeMany([{ path, json: `[${doc.editor.raw(path)},${JSON.stringify(publication)}]` }]);
    selectPublication(doc, family, current.length);
  });
}

export function duplicatePublication(doc: ScenarioDoc, family: PublicationFamily, selected: number): Prepared<void> {
  return editDocument(doc, () => {
    const path = publicationPaths[family];
    const current = listOf(doc.editor.value(path));
    const source = recordOf(current[selected]);
    if (source === undefined) return;
    const array = Array.isArray(doc.editor.value(path));
    const raw = doc.editor.raw(array ? [...path, selected] : path);
    if (raw === undefined) return;

    const interval = contextInterval(doc, current.at(-1));
    const from = gpsOfTime(recordOf(source.from) ?? {}, doc.draftLeap());
    const until = gpsOfTime(recordOf(source.until) ?? {}, doc.draftLeap());
    const next = gpsOfTime(recordOf(interval.from) ?? {}, doc.draftLeap());
    const changes: WriteChange[] = array ? [] : [{ path, json: `[${raw}]` }];
    changes.push({ path: [...path, current.length], json: raw, insert: true });
    if (from !== null && until !== null && until > from && next !== null) {
      changes.push(
        { path: [...path, current.length, "from"], value: interval.from },
        { path: [...path, current.length, "until"], value: timeOf("GPS", next + until - from, doc.draftLeap()) },
      );
    }
    doc.editor.writeMany(changes);
    selectPublication(doc, family, current.length);
  });
}

export function removePublication(doc: ScenarioDoc, family: PublicationFamily, selected: number): Prepared<void> {
  return editDocument(doc, () => {
    const path = publicationPaths[family];
    if (Array.isArray(doc.editor.value(path))) doc.editor.write([...path, selected], undefined);
    else doc.editor.write(path, undefined);
    discardDraftsAt(doc.editor, path);
    selectPublication(doc, family, Math.max(0, selected - 1));
  });
}
