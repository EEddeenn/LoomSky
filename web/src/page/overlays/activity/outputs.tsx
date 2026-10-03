"use client";

import { cancelOperation, isOperationActive, useOperations } from "@/workbench/operations";
import { openResource } from "@/workbench/navigation";
import { Button, Spinner } from "@/page/shared/ui";

const phases = {
  preparing: "Preparing…",
  running: "Running…",
  committing: "Saving result…",
  succeeded: "Completed",
  partial: "Completed with failures",
  failed: "Failed",
  cancelled: "Cancelled",
};
const itemStatuses = {
  pending: "Waiting",
  reading: "Reading…",
  committing: "Saving…",
  succeeded: "Added",
  failed: "Failed",
  cancelled: "Cancelled",
  unprocessed: "Not processed",
};

export function Operations() {
  const records = useOperations();
  const operations = [...records].sort((a, b) => Number(isOperationActive(b)) - Number(isOperationActive(a)) || b.startedAt - a.startedAt);
  const running = operations.filter(isOperationActive).length;
  if (operations.length === 0) return null;
  return (
    <section aria-label="Operations" className="max-h-[45%] flex-none overflow-y-auto overscroll-contain border-b border-line2">
      <h3 className="sticky top-0 z-1 m-0 bg-panel px-4 py-2 text-small font-semibold">Operations <span className="fn ml-1 font-normal text-ink3">{running > 0 ? `${running} running` : `${operations.length} recent`}</span></h3>
      <ul className="m-0 list-none p-0">
        {operations.map((operation) => {
          const active = isOperationActive(operation);
          const percent = operation.progress === null ? null : Math.floor(operation.progress * 100);
          const imported = operation.kind === "import" ? operation.items.filter((item) => item.status === "succeeded").length : 0;
          const failed = operation.kind === "import" ? operation.items.filter((item) => item.status === "failed").length : 0;
          return (
            <li key={operation.id} className="flex flex-col gap-2 border-t border-line px-4 py-3">
              <div className="flex items-start gap-2">
                {active ? <Spinner /> : null}
                <div className="min-w-0 flex-1">
                  <div className="text-small font-medium [overflow-wrap:anywhere]">{operation.name}</div>
                  <div role="status" className={`text-small ${operation.phase === "failed" || operation.phase === "partial" ? "text-fault" : "text-ink3"}`}>{operation.cancellationRequested && active ? "Cancelling…" : phases[operation.phase]}</div>
                </div>
                {active && (operation.cancellable || operation.cancellationRequested) ? <Button size="sm" disabled={operation.cancellationRequested} onClick={() => cancelOperation(operation.id)}>{operation.cancellationRequested ? "Cancelling…" : "Cancel"}</Button> : null}
              </div>
              {!active || percent === null ? null : <div role="progressbar" aria-label={operation.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="fn text-small text-ink3">{percent} %</div>}
              {operation.error === null ? null : <p className="m-0 text-small text-fault [overflow-wrap:anywhere]">{operation.error}</p>}
              {operation.kind !== "import" ? null : <>
                <p className="m-0 text-small text-ink3">{imported} of {operation.items.length} available in Library{failed === 0 ? "" : ` · ${failed} failed`}</p>
                <ul className="m-0 list-none rounded-key border border-line p-0">
                  {operation.items.map((item) => <li key={item.index} className="flex flex-col gap-1 border-t border-line px-2 py-2 first:border-t-0">
                    <div className="flex items-start gap-2">
                      <span className="min-w-0 flex-1 text-small [overflow-wrap:anywhere]">{item.name}</span>
                      <span className={`flex-none text-small ${item.status === "failed" ? "text-fault" : "text-ink3"}`}>{item.outcome === "reused" ? "Already present" : itemStatuses[item.status]}</span>
                    </div>
                    {item.error === null ? null : <p className="m-0 text-small text-fault [overflow-wrap:anywhere]">{item.error}</p>}
                    {item.resource === null ? null : <Button size="xs" variant="ghost" className="self-start" aria-label={`Open ${item.name}`} onClick={() => { if (item.resource !== null) openResource(item.resource); }}>Open</Button>}
                  </li>)}
                </ul>
              </>}
              {operation.kind !== "export" || operation.result === null ? null : <p className="m-0 text-small text-ink3 [overflow-wrap:anywhere]">Download requested: {operation.result.name} · {operation.result.bytes.toLocaleString()} bytes</p>}
              {operation.resource === null && (operation.kind !== "duplicate" || operation.result === null) ? null : <div className="flex flex-wrap gap-2">
                {operation.resource === null ? null : <Button size="xs" variant="ghost" onClick={() => { if (operation.resource !== null) openResource(operation.resource); }}>Open source</Button>}
                {operation.kind !== "duplicate" || operation.result === null ? null : <Button size="xs" variant="ghost" onClick={() => { if (operation.result !== null) openResource(operation.result); }}>Open copy</Button>}
              </div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
