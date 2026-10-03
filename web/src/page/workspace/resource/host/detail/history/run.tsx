"use client";

import { EffectiveInspector } from "@/page/shared/preview/effective";
import { sourceWords } from "@/workbench/hosts";
import type { HostDisplay } from "../../display";
import { submissionTruthOf } from "@/model/host";
import type { SubmissionRecord } from "@/model/host";
import { TruthButtons } from "@/page/shared/preview/outputs";
import { useSubmissionPreviewSession } from "@/workbench/preview";
import { EffectivePanel } from "../effective";
import { SubmissionSnapshot } from "../snapshot";

export function HistoricalRun({ view, submission }: Pick<HostDisplay, "view"> & { submission: SubmissionRecord }) {
  const source = (submission.key === view.submission?.key ? view.truth : null) ?? submissionTruthOf(submission);
  const { session, frame } = useSubmissionPreviewSession(submission, source);
  return (
    <div className="flex flex-col gap-4 border-t border-line2 p-5">
      <div>
        <h2 className="m-0 text-title font-semibold">Run {submission.run} · {sourceWords(submission.source)}</h2>
        <p className="m-0 mt-1 text-small text-ink3">Boot <code>{submission.boot}</code></p>
      </div>
      <SubmissionSnapshot key={submission.key} submission={submission} />
      <section className="flex flex-col gap-2">
        <h3 className="lab m-0">Modeled outputs</h3>
        {source === null ? (
          <p className="m-0 text-small text-ink3">Outputs unavailable: sent range or command history is missing.</p>
        ) : submission.summary.observation === null && submission.summary.position === null ? (
          <p className="m-0 text-small text-ink3">No observation or position outputs requested.</p>
        ) : (
          <>
            <p className="m-0 text-small text-ink2">Modeled over the reported range and applied commands; may include gaps.</p>
            <TruthButtons
              id={`${submission.source.scenarioId}-run-${submission.run}`}
              outputs={{ observation: submission.summary.observation !== null, position: submission.summary.position?.format.toLowerCase() ?? null }}
              request={{ kind: "truth", source: { ...source, kind: "run", name: `run-${source.run.boot}-${source.run.sequence}` } }}
            />
          </>
        )}
      </section>
      <EffectivePanel id={`history:${submission.key}:effective`}><EffectiveInspector frame={frame} onSeek={session.seek} onSelect={session.select} /></EffectivePanel>
    </div>
  );
}
