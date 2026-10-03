"use client";

import type { HostDisplay } from "@/page/workspace/resource/host";
import { ScrollArea } from "../scroll";
import { DetailSection } from "./section";
import { CommandForm } from "./run/commands/form";
import { CommandLog } from "./run/commands/log";
import { RunDetails } from "./run/details";
import { RunOutputs } from "./run/outputs";
import { Tally } from "./run/tally";

export function HostRun(display: HostDisplay) {
  const { host, view } = display;
  const { status, submission, truth, sourceError } = view;
  const canCommand = status !== null && !(status.state === "ended" && "refused" in status.outcome);
  return (
    <ScrollArea pane="run">
      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(340px,1fr)] max-[1100px]:grid-cols-1">
        <div className="min-w-0 border-r border-line max-[1100px]:border-r-0">
          <Tally {...display} />
          <RunDetails {...display} />
        </div>
        <div className="min-w-0">
          <DetailSection title="Commands">
            {canCommand ? <CommandForm {...display} /> : <p className="m-0 text-small text-ink3">Start a run to send commands.</p>}
          </DetailSection>
          <DetailSection title="Command history"><CommandLog {...display} /></DetailSection>
          <RunOutputs hostKey={host.key} submission={submission} truth={truth} sourceError={sourceError} />
        </div>
      </div>
    </ScrollArea>
  );
}
