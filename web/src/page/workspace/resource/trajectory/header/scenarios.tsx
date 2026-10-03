import { useId } from "react";
import { NavLink } from "@/page/shared/navigation";
import { Button, closePopover, Popover, PopoverBody, PopoverHead } from "@/page/shared/ui";
import { useStore } from "@/core";
import { scenariosUsingTrajectory, scenarioCatalog } from "@/workbench/documents/scenario";
import type { TrajectoryDoc } from "@/workbench/documents/trajectory";

export function scenarioName(id: string): string {
  const entry = scenarioCatalog.get().entries.get(id);
  return entry?.working?.summary.name || entry?.head.summary.name || id;
}

export function TrajectoryUsage({ doc }: { doc: TrajectoryDoc }) {
  const id = useId();
  useStore(scenarioCatalog, (state) => state.version);
  const users = scenariosUsingTrajectory(doc.id);
  if (users.length === 0) return null;
  return (
    <>
      <Button id={`${id}-usage`} size="sm" variant="ghost" popoverTarget={`${id}-scenarios`} aria-label={`Used by ${users.length} ${users.length === 1 ? "scenario" : "scenarios"}`}>
        {users.length} {users.length === 1 ? "scenario" : "scenarios"}
      </Button>
      <Popover id={`${id}-scenarios`} anchor={`${id}-usage`} width={320} label="Scenarios using this trajectory">
        <PopoverHead title="Used by" />
        <PopoverBody>
          {users.map((scenario) => {
            const reference = scenario.working?.summary ?? scenario.head.summary;
            return (
            <div key={scenario.head.id} className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-small">
              <NavLink
                className="min-w-0 text-left underline decoration-ink3 underline-offset-3 hover:text-ink [overflow-wrap:anywhere]"
                destination={{ workspace: "resource", kind: "scenario", id: scenario.head.id, tab: "setup" }}
                onClick={(event) => closePopover(event.currentTarget)}
              >
                {scenarioName(scenario.head.id)}
              </NavLink>
              <span className="fn text-ink3">v{reference.trajectoryVersionNumber}</span>
              {reference.trajectoryVersionId === doc.saved.version.id || (reference.trajectoryVersionNumber ?? 0) >= doc.saved.version.number ? null : <span className="text-ink3">Newer saved version</span>}
            </div>
          ); })}
          <p className="m-0 text-small text-ink3">Scenarios keep their selected version until you update them.</p>
        </PopoverBody>
      </Popover>
    </>
  );
}
