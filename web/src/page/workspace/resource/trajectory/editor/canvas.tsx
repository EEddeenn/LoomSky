"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { trimmed } from "@/core";
import { planFrom } from "@/model/trajectory";
import { CodeView } from "@/page/shared/documents/editor";
import { DiagnosticCue } from "@/page/shared/feedback";
import { usePreviewView } from "@/page/shared/preview/use-preview-view";
import { Button, useSize } from "@/page/shared/ui";
import type { TrajectoryDoc } from "@/workbench/documents/trajectory";
import type { EditOutcome } from "@/workbench/documents/trajectory/editing";
import { distanceOf } from "@/model/trajectory";
import { replaceProblems, reportProblem } from "@/workbench/feedback";
import { navigate } from "@/workbench/navigation";
import { reportPendingIssue } from "@/workbench/documents/editing";
import { useTrajectoryPreviewSession } from "@/workbench/preview";
import { TrajectoryInspector } from "./inspector";
import { TrajectoryMap } from "./map";
import { TrajectoryOutline } from "./outline";
import { TrajectoryTimeline } from "./timeline";
import { TrajectoryToolbar } from "./toolbar";

export function TrajectoryCanvas({ doc, view }: { doc: TrajectoryDoc; view: "form" | "json" }) {
  const session = doc.editing;
  const state = useSyncExternalStore(session.subscribe, session.get, session.get);
  const gesture = state.edit.kind === "gesture" ? state.edit : null;
  const plan = planFrom(gesture?.candidate ?? doc.editor.value([]));
  const preview = doc.view?.previewShape ?? null;
  const track = gesture === null ? doc.view?.currentShape ?? null : preview;
  const { session: previewSession, frame } = useTrajectoryPreviewSession(doc, track);
  usePreviewView(previewSession);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const size = useSize(container);
  const [charts, setCharts] = useState(true);
  const problemOwner = `trajectory-edit:${doc.id}`;
  const blockedAt = useRef<{ rev: number; tool: typeof state.tool; view: typeof view } | null>(null);
  const report = (outcome: EditOutcome) => {
    if (outcome.ok) {
      blockedAt.current = null;
      replaceProblems(problemOwner, []);
      return true;
    }
    if (outcome.issue !== undefined) reportPendingIssue({ kind: "trajectory", id: doc.id }, outcome.issue);
    else if (outcome.level === "error") {
      reportProblem({ id: `${problemOwner}:failure`, level: "error", scope: doc.name, title: "Trajectory edit failed", message: outcome.message });
    } else {
      blockedAt.current = { rev: doc.editor.rev, tool: state.tool, view };
      replaceProblems(problemOwner, [{
        id: problemOwner, level: "warning", scope: doc.name, title: "Trajectory edit blocked", message: outcome.message,
        actions: [{ id: "open-trajectory", label: "Open trajectory", run: () => navigate({ workspace: "resource", kind: "trajectory", id: doc.id }) }],
      }]);
    }
    return false;
  };

  useEffect(() => {
    const current = blockedAt.current;
    if (current !== null && (current.rev !== doc.editor.rev || current.tool !== state.tool || current.view !== view)) {
      blockedAt.current = null;
      replaceProblems(problemOwner, []);
    }
  }, [problemOwner, doc.editor.rev, state.tool, view]);
  useEffect(() => () => replaceProblems(problemOwner, []), [problemOwner]);

  const durationDelta = gesture === null || preview === null ? null : preview.duration - (gesture.baseline.track?.duration ?? 0);
  const distanceDelta = gesture === null || preview === null ? null : distanceOf(preview) - distanceOf(gesture.baseline.track);
  const mapVisible = view !== "json" || size.width >= 1000;
  return (
    <div ref={setContainer} className="flex min-h-0 min-w-0 flex-1 flex-col">
      {view === "form" ? <TrajectoryToolbar doc={doc} session={session} state={state} charts={charts} onToggleCharts={() => setCharts((value) => !value)} onOutcome={report} /> : null}
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className={`relative flex min-h-0 min-w-0 flex-1 flex-col ${mapVisible ? "" : "hidden"}`}>
          <div className="relative grid min-h-0 min-w-0 flex-1">
            <TrajectoryMap doc={doc} plan={plan} frame={frame} previewSession={previewSession} session={session} state={state} visible={mapVisible} interactive={view === "form"} onOutcome={report} />
            {gesture !== null ? (
              <div aria-live="polite" className="pointer-events-none absolute right-3 bottom-9 left-3 z-20 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-key bg-face px-3 py-2 text-small ring-key">
                <strong>{gesture.label}</strong>
                {durationDelta === null ? <span>Solving…</span> : <span className="fn">Distance {(distanceDelta ?? 0) >= 0 ? "+" : ""}{trimmed(Number((distanceDelta ?? 0).toFixed(1)))} m · End {durationDelta >= 0 ? "+" : ""}{trimmed(Number(durationDelta.toFixed(2)))} s</span>}
                <span className="pointer-events-auto"><DiagnosticCue docId={doc.id} diagnostics={doc.view?.previewDiagnostics ?? []} problemIdPrefix="preview:" /></span>
                <span className="text-ink3">Esc cancels · release commits</span>
              </div>
            ) : null}
          </div>
          {view === "form" ? <TrajectoryTimeline doc={doc} plan={plan} frame={frame} onSeek={previewSession.seek} selected={state.selected} session={session} expanded={charts} onExpandedChange={setCharts} onSelect={(selection) => session.select(selection)} onOutcome={report} /> : null}
        </div>
        {view === "json" ? (
          <div className={`flex min-h-0 min-w-0 flex-col border-l border-line2 ${size.width < 1000 ? "flex-1" : "w-1/2"}`}>
            <CodeView doc={doc.editor} />
          </div>
        ) : state.panel === null ? null : (
          <aside aria-label="Trajectory details" className={`z-30 flex min-h-0 min-w-0 flex-none flex-col border-l border-line2 bg-panel ${size.width >= 1100 ? "w-80" : `absolute inset-y-0 right-0 shadow-[var(--shadow)] ${size.width < 640 ? "left-0" : "w-80 max-w-full"}`}`}>
            <div className="flex h-10 flex-none items-center gap-1 border-b border-line2 px-2">
              <div role="group" aria-label="Details panel" className="flex min-w-0 flex-1 items-center gap-1">
                {(["objects", "properties"] as const).map((panel) => (
                  <Button key={panel} size="sm" variant="ghost" aria-pressed={state.panel === panel} className={state.panel === panel ? "bg-hover text-ink" : ""} onClick={() => session.showPanel(panel)}>{panel === "objects" ? "Objects" : "Properties"}</Button>
                ))}
              </div>
              <Button size="sm" variant="ghost" icon="x" iconOnly aria-label="Close details" title="Close details" onClick={() => session.showPanel(null)} />
            </div>
            {state.panel === "objects" && plan !== null ? (
              <TrajectoryOutline doc={doc} plan={plan} selected={state.selected} session={session} onSelect={(selection) => { session.select(selection); session.showInspector(true); }} onOutcome={report} />
            ) : (
              <TrajectoryInspector doc={doc} plan={plan} selected={state.selected} session={session} onSelect={(selection) => session.select(selection)} onOutcome={report} />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
