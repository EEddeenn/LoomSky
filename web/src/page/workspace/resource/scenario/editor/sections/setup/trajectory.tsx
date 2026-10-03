"use client";

import { useStore } from "@/core";
import { NavLink } from "@/page/shared/navigation";
import { Button } from "@/page/shared/ui";
import { Messages } from "@/page/shared/documents/editor";
import { diagnosticsAt } from "@/model/document";
import { chooseScenarioTrajectory } from "@/workbench/documents/scenario/actions";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import { trajectoryCatalog } from "@/workbench/documents/trajectory";

export function TrajectoryBinding({ doc }: { doc: ScenarioDoc }) {
  const catalog = useStore(trajectoryCatalog, (s) => s);
  const adopted = doc.trajectory;
  const bound = doc.boundTrajectory;
  const entry = bound === null ? undefined : catalog.entries.get(bound.resourceId);
  const trajectory = entry?.head.archivedAt === null ? entry : undefined;
  const reference = doc.editor.value(["trajectory"]);
  const version = bound === null ? "Saved version" : `v${bound.versionNumber}`;
  const availability = adopted !== null && bound === null ? "Version details unavailable"
    : trajectory !== undefined ? `Latest saved: v${trajectory.head.headVersionNumber}`
    : catalog.error !== null ? "Could not load Library"
      : !catalog.loaded ? "Loading Library…"
        : adopted !== null ? "Archived · version retained"
          : null;

  return (
    <section className="flex min-w-0 flex-col gap-3 border-t border-line pt-4" aria-label="Scenario trajectory" data-path="scenario:trajectory">
      <h4 className="lab m-0 text-ink2">Trajectory</h4>
      <div className="flex min-w-0 flex-col gap-3 rounded-key border border-line bg-face p-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{bound?.name ?? (adopted === null ? "No trajectory selected" : "Saved trajectory")}</span>
          {adopted === null ? null : <Button size="xs" disabled={!doc.editor.writable()} aria-label={`Choose trajectory version, currently ${version}`} onClick={() => chooseScenarioTrajectory(doc)}>{version} ▾</Button>}
        </div>
        {adopted === null ? null : <p className="m-0 text-small text-ink2">Fixed saved version</p>}
        {availability === null ? null : <p className={`m-0 text-small [overflow-wrap:anywhere] ${catalog.error !== null && trajectory === undefined ? "text-fault" : "text-ink2"}`}>{availability}</p>}
        {adopted === null && typeof reference === "string" ? <p className="m-0 min-w-0 text-small text-ink2 [overflow-wrap:anywhere]">Referenced file: <code>{reference}</code></p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" icon="folder" disabled={!doc.editor.writable()} onClick={() => chooseScenarioTrajectory(doc)}>{adopted === null ? "Choose from Library…" : "Choose version…"}</Button>
          {trajectory === undefined ? null : <NavLink size="sm" variant="default" destination={{ workspace: "resource", kind: "trajectory", id: trajectory.head.id, returnScenario: doc.id }}>Open editor</NavLink>}
        </div>
        {bound !== null && trajectory !== undefined && trajectory.head.headVersionId !== bound.versionId && trajectory.head.headVersionNumber > bound.versionNumber ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-small text-ink2">
            <span>v{trajectory.head.headVersionNumber} available</span>
            <Button size="xs" disabled={!doc.editor.writable()} onClick={() => chooseScenarioTrajectory(doc)}>Choose version…</Button>
          </div>
        ) : null}
      </div>
      <Messages doc={doc.editor} diagnostics={diagnosticsAt(doc.editor, ["trajectory"])} />
    </section>
  );
}
