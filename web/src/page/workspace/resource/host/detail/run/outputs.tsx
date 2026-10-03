"use client";

import type { RunTruth, SubmissionRecord } from "@/model/host";
import { offset } from "@/core";
import { openProblems } from "@/workbench/feedback";
import { TruthButtons } from "@/page/shared/preview/outputs";
import { Button } from "@/page/shared/ui";
import { DetailSection } from "../section";

export function RunOutputs({ hostKey, submission: sub, truth, sourceError }: { hostKey: string; submission: SubmissionRecord | null; truth: RunTruth | null; sourceError: string | null }) {
  return (
    <DetailSection title="Modeled outputs">
      {sourceError !== null ? <Button size="xs" variant="ghost" className="self-start" onClick={() => openProblems(`host:${hostKey}:submission`)}>Details</Button> : sub?.summary == null ? (
        <p className="m-0 text-small text-ink3">Run snapshot unavailable in this browser.</p>
      ) : (
        <>
          <p className="m-0 text-small text-ink2">
            {truth === null ? "Sent range unavailable." : `Modeled ${offset(truth.range.first)}–${offset(truth.range.end - 1)}, with applied commands; may include gaps.`}
          </p>
          {sub.summary.observation === null && sub.summary.position === null ? (
            <p className="m-0 text-small text-ink3">No observation or position outputs requested.</p>
          ) : (
            <TruthButtons
              id={`${sub.source.scenarioId}-run-${sub.run}`}
              outputs={{ observation: sub.summary.observation !== null, position: sub.summary.position?.format.toLowerCase() ?? null }}
              request={truth === null ? null : { kind: "truth", source: { ...truth, kind: "run", name: `run-${truth.run.boot}-${truth.run.sequence}`, resource: { kind: "host", key: hostKey } } }}
            />
          )}
        </>
      )}
    </DetailSection>
  );
}
