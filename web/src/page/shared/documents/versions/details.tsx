"use client";

import { savedVersionName } from "@/model/version";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { TrajectoryRevision } from "@/model/trajectory";
import { resolveTrajectoryBuild } from "@/workbench/documents/trajectory/builds";
import type { BuildRecord, SavedVersion, ScenarioSnapshot, TrajectorySnapshot } from "@/model/version";
import { Button, FeedbackIcon, Softkeys } from "../../ui";
import { sourceDiff } from "./diff";
import { savedTime, versionLabel } from "./format";

type Snapshot = ScenarioSnapshot | TrajectorySnapshot;

function TrajectoryLabel({ pin, details }: { pin: TrajectoryRevision; details: boolean }) {
  const [resolved, setResolved] = useState<Awaited<ReturnType<typeof resolveTrajectoryBuild>> | null>(null);
  const [failed, setFailed] = useState(false);
  const { versionId, buildId } = pin;
  useEffect(() => {
    const controller = new AbortController();
    void resolveTrajectoryBuild({ versionId, buildId }, { signal: controller.signal }).then(
      (value) => { if (!controller.signal.aborted) setResolved(value); },
      () => { if (!controller.signal.aborted) setFailed(true); },
    );
    return () => controller.abort();
  }, [versionId, buildId]);
  if (resolved === null) return <span className="text-ink3">{failed ? "Saved trajectory unavailable" : "Loading trajectory…"}</span>;
  return <>{savedVersionName(resolved.version)} <span className="fn text-ink3">{versionLabel(resolved.version.number)}</span>
    {details ? <span className="mt-0.5 block text-ink3">Fixed version · {resolved.record.artifacts.pht.name}</span> : null}
  </>;
}

function trajectoryLabel(pin: TrajectoryRevision | null, details = false): ReactNode {
  return pin === null ? "None" : <TrajectoryLabel key={`${pin.versionId}:${pin.buildId}`} pin={pin} details={details} />;
}

function dependencyChanges(snapshot: Snapshot, previous: Snapshot): { label: string; before: ReactNode; after: ReactNode }[] {
  const changes: { label: string; before: ReactNode; after: ReactNode }[] = [];
  if ("name" in snapshot && "name" in previous && snapshot.name !== previous.name) changes.push({ label: "Name", before: previous.name, after: snapshot.name });
  if ("bindings" in snapshot && "bindings" in previous) {
    const next = snapshot.bindings.trajectory;
    const old = previous.bindings.trajectory;
    if (next?.buildId !== old?.buildId) changes.push({ label: "Trajectory", before: trajectoryLabel(old), after: trajectoryLabel(next) });
    const names = new Set([...Object.keys(previous.bindings.files), ...Object.keys(snapshot.bindings.files)]);
    for (const name of names) {
      const a = Object.hasOwn(previous.bindings.files, name) ? previous.bindings.files[name] : undefined;
      const b = Object.hasOwn(snapshot.bindings.files, name) ? snapshot.bindings.files[name] : undefined;
      if (a !== b) changes.push({ label: name, before: a === undefined ? "Not attached" : `File ${a.slice(0, 12)}`, after: b === undefined ? "Not attached" : `File ${b.slice(0, 12)}` });
    }
  }
  return changes;
}

function SourceSnapshot({ text }: { text: string }) {
  return <pre tabIndex={0} aria-label="Saved source" className="fn m-0 max-h-96 overflow-auto overscroll-contain rounded-key bg-face p-3 text-small leading-5 text-ink2 ring-key"><code>{text}</code></pre>;
}

export function SnapshotChanges({ snapshot, previous, label }: { snapshot: Snapshot; previous: Snapshot | null; label: string }) {
  const [mode, setMode] = useState<"changes" | "source">("changes");
  const [allLines, setAllLines] = useState(false);
  const rows = useMemo(() => previous === null ? [] : sourceDiff(previous.source.text, snapshot.source.text), [previous, snapshot]);
  const changed = rows.some((row) => row.kind !== "same");
  const dependencies = previous === null ? [] : dependencyChanges(snapshot, previous);
  const visible = allLines ? rows : rows.filter((row, index) => row.kind !== "same" || rows.slice(Math.max(0, index - 3), index + 4).some((nearby) => nearby.kind !== "same"));
  return <section className="space-y-3" aria-label="Version content">
    <div className="flex flex-wrap items-center gap-3">
      <h3 className="m-0 flex-1 text-body font-semibold">{label}</h3>
      {previous === null ? null : <Softkeys<"changes" | "source"> label="Version content view" options={[["changes", "Changes"], ["source", "Source"]]} value={mode} onChange={setMode} />}
    </div>
    {mode === "source" || previous === null ? <SourceSnapshot text={snapshot.source.text} /> : <>
      {dependencies.length === 0 ? null : <dl className="m-0 divide-y divide-line rounded-key bg-face px-3 ring-key">
        {dependencies.map((change) => <div key={change.label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3 py-2 text-small"><dt className="break-words text-ink3">{change.label}</dt><dd className="m-0 flex flex-wrap gap-x-2 gap-y-1"><del className="text-ink3">{change.before}</del><span>{change.after}</span></dd></div>)}
      </dl>}
      {!changed ? <p className="m-0 text-small text-ink3">{dependencies.length === 0 ? "No changes." : "Source text unchanged."}</p> : <>
        <div className="flex items-center justify-between gap-2 text-small"><span className="text-ink3">+{rows.filter((row) => row.kind === "added").length} / −{rows.filter((row) => row.kind === "removed").length} lines</span><Button size="xs" variant="ghost" onClick={() => setAllLines(!allLines)}>{allLines ? "Changes only" : "All lines"}</Button></div>
        <div tabIndex={0} aria-label="Source changes" className="max-h-96 overflow-auto overscroll-contain rounded-key bg-face ring-key">
          <table className="fn w-full border-collapse text-small leading-5"><tbody>{visible.map((row, index) => <tr key={index} className={row.kind === "removed" ? "bg-fault/8" : row.kind === "added" ? "bg-sel/10" : ""}>
            <td className="w-8 select-none px-2 text-right align-top text-ink4">{row.before}</td><td className="w-8 select-none px-2 text-right align-top text-ink4">{row.after}</td><td className={`w-4 select-none align-top ${row.kind === "removed" ? "text-fault" : "text-ink3"}`}>{row.kind === "removed" ? "−" : row.kind === "added" ? "+" : ""}</td><td className="whitespace-pre pr-3 text-ink2">{row.text || " "}</td>
          </tr>)}</tbody></table>
        </div>
      </>}
    </>}
  </section>;
}

function Dependencies({ snapshot }: { snapshot: Snapshot }) {
  if (!("bindings" in snapshot)) return null;
  const trajectory = snapshot.bindings.trajectory;
  const files = Object.entries(snapshot.bindings.files);
  return <section className="space-y-2" aria-label="Saved dependencies">
    <h3 className="m-0 text-body font-semibold">Dependencies</h3>
    <dl className="m-0 space-y-2 text-small">
      <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-3"><dt className="text-ink3">Trajectory</dt><dd className="m-0 break-words">{trajectoryLabel(trajectory, true)}</dd></div>
      {files.map(([name, digest]) => <div key={name} className="grid grid-cols-[100px_minmax(0,1fr)] gap-3"><dt className="text-ink3">Data file</dt><dd className="m-0 min-w-0"><span className="block break-words">{name}</span><span className="fn mt-0.5 block truncate text-ink3" title={digest}>{digest.slice(0, 16)}</span></dd></div>)}
      {files.length === 0 ? <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-3"><dt className="text-ink3">Data files</dt><dd className="m-0 text-ink3">None</dd></div> : null}
    </dl>
  </section>;
}

function BuildDetails({ builds }: { builds: readonly BuildRecord[] }) {
  if (builds.length === 0) return <section className="space-y-2"><h3 className="m-0 text-body font-semibold">Checks</h3><p className="m-0 text-small text-ink3">No saved check result.</p></section>;
  return <section className="space-y-2" aria-label="Saved verification results">
    <h3 className="m-0 text-body font-semibold">Checks</h3>
    {builds.map((build, index) => <details key={build.id} open={index === 0} className="rounded-key bg-face px-3 py-2 ring-key">
      <summary className="cursor-pointer text-small"><span className="ml-1 inline-flex items-center gap-1.5"><FeedbackIcon level={build.status === "success" ? "success" : "error"} size={13} /><span>{build.status === "success" ? "Verified" : "Check failed"}</span><time className="text-ink3" dateTime={new Date(build.created).toISOString()}>{savedTime(build.created, true)}</time></span></summary>
      {build.diagnostics.length === 0 ? null : <ul className="mb-0 mt-2 list-none space-y-2 p-0">{build.diagnostics.map((diagnostic, i) => <li key={i} className="flex gap-2 text-small"><FeedbackIcon level={diagnostic.error ? "error" : "warning"} size={13} /><div className="min-w-0"><p className="m-0 break-words">{diagnostic.message}</p><span className="fn text-ink3">{diagnostic.file}{diagnostic.path ? ` · ${diagnostic.path}` : ""}</span></div></li>)}</ul>}
      {Object.keys(build.artifacts).length === 0 ? null : <dl className="mb-0 mt-3 space-y-1 border-t border-line pt-2 text-small">{Object.entries(build.artifacts).map(([key, artifact]) => artifact === undefined ? null : <div key={key} className="flex min-w-0 gap-3"><dt className="w-14 flex-none uppercase text-ink3">{key}</dt><dd className="m-0 min-w-0 flex-1 truncate" title={artifact.digest}>{artifact.name}</dd></div>)}</dl>}
    </details>)}
  </section>;
}

export function VersionDetails({ version, previous = null, builds = [], history = [] }: {
  version: SavedVersion;
  previous?: SavedVersion | null;
  builds?: readonly BuildRecord[];
  history?: readonly SavedVersion[];
}) {
  const restored = history.find((candidate) => candidate.id === version.restoredFrom);
  return <div className="space-y-5">
    <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><h3 className="m-0 text-title font-semibold">{versionLabel(version.number)}</h3><p className="m-0 mt-1 break-words text-small text-ink2">{savedVersionName(version)}</p><time dateTime={new Date(version.savedAt).toISOString()} className="mt-1 block text-small text-ink3">Saved {savedTime(version.savedAt)}</time></div><span className="rounded-key bg-face px-2 py-0.5 text-small text-ink3">Read only</span></div>
    {version.note === undefined || version.note === "" ? null : <p className="m-0 whitespace-pre-wrap text-small text-ink2">{version.note}</p>}
    {version.restoredFrom === null ? null : <p className="m-0 text-small text-ink3">Restored from {restored === undefined ? "an earlier version" : versionLabel(restored.number)}.</p>}
    <BuildDetails builds={builds.filter((build) => build.versionId === version.id)} />
    <Dependencies snapshot={version.snapshot} />
    <SnapshotChanges key={version.id} snapshot={version.snapshot} previous={previous?.snapshot ?? null} label={previous === null ? "Saved source" : `Changes from ${versionLabel(previous.number)}`} />
  </div>;
}
