"use client";

import { duration, useStore } from "@/core";
import { gpsClock, satelliteName } from "@/model/gnss";
import { Band, Timeline } from "@/page/shared/preview/band";
import { EffectiveInspector } from "@/page/shared/preview/effective";
import { PreviewMap } from "@/page/shared/preview/scene";
import { usePreviewView } from "@/page/shared/preview/use-preview-view";
import { Button, Softkeys } from "@/page/shared/ui";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import { page, revealDocument, setScenarioPreview, type ScenarioPreviewView } from "@/workbench/navigation";
import { useScenarioPreviewSession } from "@/workbench/preview";

const views: readonly (readonly [ScenarioPreviewView, string])[] = [["map", "Map"], ["sky", "Sky / C/N0"], ["effective", "Effective values"]];

export function ScenarioPreview({ doc, beside }: { doc: ScenarioDoc; beside: boolean }) {
  const preview = useStore(page, (state) => state.scenarioPreview);
  const { session, frame } = useScenarioPreviewSession(doc);
  usePreviewView(session);
  const source = frame.source;
  return (
    <section aria-label="Scenario preview" className={`flex min-h-0 min-w-0 flex-col bg-display ${beside ? "" : "border-t border-line2"}`}>
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <Softkeys label="Preview view" options={views} value={preview.view} onChange={(view) => setScenarioPreview({ view })} />
        {source !== null && !source.current ? <span role="status" className="ml-auto text-small text-warn-ink">Showing last valid preview</span> : null}
      </div>
      {preview.view === "map" ? (
        <div className="relative grid min-h-0 min-w-0 flex-1"><PreviewMap frame={frame} session={session} /></div>
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
      {frame.window === null ? null : <div className="flex-none border-t border-line2">
        <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1 text-small">
          <span className="lab text-ink2">Time</span>
          <span className="fn">{gpsClock(frame.window.startGpsMs + frame.epochMs, true)} GPS</span>
          <span className="ml-auto text-ink3">{duration(frame.window.durationMs)}</span>
        </div>
        <Timeline frame={frame} onSeek={session.seek} />
        {frame.adjustment === null ? null : <p role="status" className="m-0 border-t border-line px-3 py-1 text-small text-ink2">{frame.adjustment}</p>}
      </div>}
    </section>
  );
}
