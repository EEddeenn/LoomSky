"use client";

import { useSyncExternalStore } from "react";
import { duration, useStore } from "@/core";
import { gpsClock, satelliteName } from "@/model/gnss";
import { Band, Timeline } from "@/page/shared/preview/band";
import { EffectiveInspector } from "@/page/shared/preview/effective";
import { PreviewMap } from "@/page/shared/preview/scene";
import { usePreviewView } from "@/page/shared/preview/use-preview-view";
import { Button, Softkeys, Spinner } from "@/page/shared/ui";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import { openProblems } from "@/workbench/feedback";
import { page, revealDocument, setScenarioPreview, type ScenarioPreviewView, type ScenarioTab } from "@/workbench/navigation";
import { useScenarioPreviewSession } from "@/workbench/preview";

const views: readonly (readonly [ScenarioPreviewView, string])[] = [["map", "Map"], ["sky", "Sky / C/N0"], ["effective", "Effective values"]];
const relatedViews: Record<ScenarioTab, ScenarioPreviewView> = { setup: "map", navigation: "effective", signals: "sky", messages: "effective", outputs: "sky" };

export function ScenarioPreview({ doc, section, beside }: { doc: ScenarioDoc; section: ScenarioTab; beside: boolean }) {
  const preview = useStore(page, (state) => state.scenarioPreview);
  const { session, frame } = useScenarioPreviewSession(doc);
  const viewport = usePreviewView(session);
  const pending = useSyncExternalStore((listener) => doc.editing.subscribeInputs(listener), () => doc.pending, () => false);
  const source = frame.source;
  const fresh = source?.current === true;

  const related = relatedViews[section];
  const stateText = source === null
    ? doc.editor.status === "errors" ? "Fix inputs to preview." : "Preparing preview…"
    : fresh ? `Working copy · ${pending ? "inputs pending" : "checks passed"}`
    : `Last passed checks · ${doc.editor.status === "errors" ? "errors in working copy" : "checking…"}`;
  return (
    <section aria-label="Scenario preview" className={`flex min-h-0 min-w-0 flex-col bg-display ${beside ? "" : "border-t border-line2"}`}>
      <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2">
        <h3 className="lab m-0 text-ink">Preview</h3>
        <span role="status" className={`min-w-0 text-small ${source !== null && !fresh ? "text-warn-ink" : "text-ink2"}`}>{stateText}</span>
        <div className="ml-auto flex items-center gap-1">
          {doc.editor.status === "checking" ? <Spinner /> : doc.editor.status === "errors" ? <Button size="xs" variant="ghost" onClick={() => openProblems()}>Problems</Button> : null}
          <Button size="xs" variant="ghost" onClick={() => setScenarioPreview({ dock: preview.dock === "right" ? "below" : "right" })}>
            {preview.dock === "right" ? "Dock below" : "Dock right"}
          </Button>
        </div>
      </div>
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <Softkeys label="Preview view" options={views} value={preview.view} onChange={(view) => setScenarioPreview({ view })} />
        {related === preview.view ? null : <Button className="ml-auto" size="xs" variant="ghost" onClick={() => setScenarioPreview({ view: related })}>Related: {views.find(([key]) => key === related)?.[1]}</Button>}
      </div>
      {preview.view === "map" ? (
        <div className="relative grid min-h-0 min-w-0 flex-1"><PreviewMap frame={frame} session={session} viewport={viewport} /></div>
      ) : (
        <div className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain">
          {preview.view === "sky" ? <Band frame={frame} onSeek={session.seek} variant="sky" onSelect={session.select} /> : (
            <div className="p-4"><EffectiveInspector frame={frame} onSeek={session.seek} onSelect={session.select} /></div>
          )}
          {preview.view === "sky" ? <p className="m-0 px-4 py-3 text-small text-ink3">Predicted sky and C/N0. Select a satellite for details.</p> : null}
        </div>
      )}
      {frame.selection === null ? null : (
        <div className="flex flex-none flex-wrap items-center gap-2 border-t border-line px-3 py-2 text-small">
          <span className="fn font-medium">{satelliteName(frame.selection.system, frame.selection.svid)}</span>
          <span className="text-ink2">{frame.selection.system}{frame.selection.signal === undefined ? "" : ` · ${frame.selection.signal}`}</span>
          <div className="ml-auto flex flex-wrap items-center gap-1">
            {preview.view === "effective" ? null : <Button size="xs" variant="ghost" onClick={() => setScenarioPreview({ view: "effective" })}>Inspect values</Button>}
            <Button size="xs" variant="ghost" onClick={() => revealDocument({ kind: "scenario", id: doc.id, target: { kind: "path", path: ["power", "signalPower"] } })}>Power settings</Button>
          </div>
        </div>
      )}
      <div className="flex-none border-t border-line2">
        <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1 text-small">
          <span className="lab text-ink2">Time</span>
          {frame.window === null ? <span className="text-ink3">Awaiting checks</span> : <>
            <span className="fn">{gpsClock(frame.window.startGpsMs + frame.epochMs, true)} GPS</span>
            <span className="ml-auto text-ink3">{duration(frame.window.durationMs)}</span>
          </>}
        </div>
        {frame.window === null ? null : <Timeline frame={frame} onSeek={session.seek} />}
        {frame.adjustment === null ? null : <p role="status" className="m-0 border-t border-line px-3 py-1 text-small text-ink2">{frame.adjustment}</p>}
      </div>
    </section>
  );
}
