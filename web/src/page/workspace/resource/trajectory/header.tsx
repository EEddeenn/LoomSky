import { CheckSummary } from "@/page/shared/feedback";
import { trimmed } from "@/core";
import { NavLink } from "@/page/shared/navigation";
import { Button, Softkeys } from "@/page/shared/ui";
import { DocumentHistoryButtons, DocumentSaveStatus, SaveDocumentButton } from "@/page/shared/documents/versions";
import type { TrajectoryDoc } from "@/workbench/documents/trajectory";
import { adoptTrajectory } from "@/workbench/documents/scenario/actions";
import { generateTrajectory } from "@/workbench/documents/trajectory/actions";
import { setView } from "@/workbench/navigation";
import { scenarioName, TrajectoryUsage } from "./header/scenarios";

export { NameField } from "./header/name";

type TrajectoryActions = {
  busy: boolean;
  action(work: () => Promise<unknown>): void;
};

export function TrajectoryTools({ doc, busy, action, view }: TrajectoryActions & {
  doc: TrajectoryDoc;
  view: "form" | "json";
}) {
  return <div className="flex flex-wrap items-center gap-2">
    <Softkeys label="Trajectory view" options={[["form", "Editor"], ["json", "JSON"]]} value={view} onChange={setView} />
    <DocumentHistoryButtons doc={doc} />
    <SaveDocumentButton doc={doc} />
    {doc.editor.status === "errors" ? <Button size="sm" variant="ghost" icon="refresh" title="Retry trajectory calculation" disabled={busy} onClick={() => action(() => generateTrajectory(doc))}>Retry</Button> : null}
  </div>;
}

export function TrajectoryStatus({ doc }: { doc: TrajectoryDoc }) {
  const shape = doc.view?.shape;
  return <>{doc.editor.status === "ready" && doc.editor.diagnostics.length === 0 ? null : <CheckSummary docId={doc.id} status={doc.editor.status} diagnostics={doc.editor.diagnostics} checkingLabel="Solving…" readyLabel="Verified" />}<DocumentSaveStatus doc={doc} />{shape === null || shape === undefined ? null : <span className="fn text-small text-ink3">{trimmed(shape.duration)} s</span>}</>;
}

export function TrajectoryContext({ doc, returnScenario, busy, action }: TrajectoryActions & { doc: TrajectoryDoc; returnScenario?: string }) {
  const name = returnScenario === undefined ? undefined : scenarioName(returnScenario);
  return <>
    <TrajectoryUsage doc={doc} />
    {returnScenario === undefined ? null : <div className="flex min-w-0 flex-wrap items-center gap-1">
      <NavLink size="sm" variant="ghost" className="min-w-0" aria-label={`Return to ${name}`} title={`Return to ${name}`} destination={{ workspace: "resource", kind: "scenario", id: returnScenario, tab: "setup" }}>
        <span className="max-w-36 truncate">← {name}</span>
      </NavLink>
      <Button variant="primary" size="sm" icon="check" disabled={busy} aria-label={`Choose a saved trajectory version for ${name}`} title={`Choose a saved version for ${name}`} onClick={() => action(() => adoptTrajectory(returnScenario, doc.id))}>Choose version…</Button>
    </div>}
  </>;
}
