"use client";

import { useRef } from "react";
import { duration } from "@/core";
import { gpsClock, gpsDate } from "@/model/gnss";
import { nameOf, sourceWords } from "@/workbench/hosts";
import { useRunHistory } from "@/workbench/hosts/history";
import { openProblems } from "@/workbench/feedback";
import { useProblem } from "@/page/shared/feedback";
import { useViewport } from "@/page/shared/navigation";
import { Button, Fig } from "@/page/shared/ui";
import type { HostDisplay } from "../display";
import { HistoricalRun } from "./history/run";

export function RunHistory({ host, view }: HostDisplay) {
  const { current, records, selected, error, loading, waiting, refresh, select } = useRunHistory(host);
  const { snapshot, status } = view;
  const problemId = `host:${host.key}:history-load`;
  useProblem(problemId, error === null ? null : {
    id: problemId, level: "error", scope: nameOf(host), title: "History could not load", message: error,
    actions: [{ id: "retry-loading", label: "Retry", run: refresh }],
  });
  const scroll = useRef<HTMLDivElement>(null);
  useViewport(scroll, "host:history", !loading);

  return (
    <div ref={scroll} className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <p className="m-0 flex-1 text-small text-ink2">Runs saved in this browser, with the exact inputs sent.</p>
        <Button size="sm" disabled={loading} onClick={refresh}>Refresh</Button>
      </div>
      {snapshot !== null && status !== null && current === null ? (
        <p role="status" className="m-0 border-b border-line bg-panel px-5 py-3 text-small text-ink2">
          Run {snapshot.run}: {status.config.label || "unknown configuration"} · source unavailable in this browser.
        </p>
      ) : null}
      {error !== null ? (
        <Button size="sm" className="m-5 self-start" onClick={() => openProblems(problemId)}>Details</Button>
      ) : waiting ? (
        <p className="m-5 text-ink3">Loading history…</p>
      ) : records.length === 0 ? (
        <p className="m-5 text-ink3">No runs saved in this browser.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead className="lab bg-panel text-ink3">
                <tr>
                  <th className="px-5 py-2 font-medium">Run</th>
                  <th className="px-3 py-2 font-medium">Scenario</th>
                  <th className="px-3 py-2 font-medium">Submitted</th>
                  <th className="px-3 py-2 font-medium">Window</th>
                  <th className="px-5 py-2 font-medium"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => <tr key={record.key} className={`border-t border-line ${selected?.key === record.key ? "bg-hover" : ""}`}>
                  <td className="px-5 py-3 font-mono">{record.run}</td>
                  <td className="px-3 py-3 font-medium">{sourceWords(record.source)}</td>
                  <td className="px-3 py-3 text-small text-ink2">{new Date(record.at).toLocaleString()}</td>
                  <td className="px-3 py-3 text-small text-ink2">
                    <Fig>{`${gpsDate(record.summary.window.startGpsMs)} ${gpsClock(record.summary.window.startGpsMs)} GPS`}</Fig> · {duration(record.summary.window.durationMs)}
                  </td>
                  <td className="px-5 py-3"><Button size="xs" aria-pressed={selected?.key === record.key} onClick={() => select(record.key)}>View</Button></td>
                </tr>)}
              </tbody>
            </table>
          </div>
          {selected === null ? null : <HistoricalRun view={view} submission={selected} />}
        </>
      )}
    </div>
  );
}
