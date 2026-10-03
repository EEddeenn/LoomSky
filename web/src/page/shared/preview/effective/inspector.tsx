"use client";

import { useId, useMemo, useState } from "react";
import { gpsClock, signals, systems, type Signal, type System } from "@/model/gnss";
import type { EffectiveGroup, EffectiveValue, EffectiveValues } from "@/model/observation";
import type { PreviewFrame, PreviewSource, SignalSelection } from "@/model/preview";
import { openProblems, type Problem } from "@/workbench/feedback";
import { useEffectiveInspection } from "@/workbench/preview";
import { useProblem } from "@/page/shared/feedback";
import { Button, fieldClass, focusRing, Spinner, TextInput } from "@/page/shared/ui";

function label(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}

function valueText(value: Exclude<EffectiveValue, object>): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

type Row = { path: string; value: string; unit: string };

function effectiveRows(value: EffectiveValue, prefix = "", inheritedUnit = ""): Row[] {
  if (value === null) return [{ path: prefix, value: "Unavailable", unit: inheritedUnit }];
  if (typeof value !== "object") return [{ path: prefix, value: valueText(value), unit: inheritedUnit }];
  if (Array.isArray(value)) {
    if (value.length === 0) return [{ path: prefix, value: "None", unit: inheritedUnit }];
    return value.flatMap((item, index) => effectiveRows(item, `${prefix} [${index}]`, inheritedUnit));
  }
  const units = value.units;
  const unitMap = units !== null && typeof units === "object" && !Array.isArray(units) ? units : {};
  return Object.entries(value)
    .filter(([key]) => key !== "units")
    .flatMap(([key, entry]) => {
      const unit = unitMap[key];
      return effectiveRows(entry, prefix === "" ? label(key) : `${prefix} / ${label(key)}`, typeof unit === "string" ? unit : inheritedUnit);
    });
}

function ValueTable({ group }: { group: EffectiveGroup }) {
  const rows = effectiveRows(group);
  return (
    <div className="max-h-[460px] overflow-auto">
      <table className="w-full border-collapse text-small">
        <thead className="sticky top-0 bg-panel text-left text-ink2">
          <tr>
            <th className="px-3 py-2 font-medium">Field</th>
            <th className="px-3 py-2 font-medium">Value</th>
            <th className="px-3 py-2 font-medium">Unit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.path} className="border-t border-line">
              <th scope="row" className="w-[45%] px-3 py-1.5 text-left font-normal text-ink2 [overflow-wrap:anywhere]">{row.path}</th>
              <td className="fn px-3 py-1.5 [overflow-wrap:anywhere]">{row.value}</td>
              <td className="fn px-3 py-1.5 whitespace-nowrap text-ink2">{row.unit || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const groups = [
  ["channel", "Channel state"],
  ["model", "Model parameters"],
  ["navigation", "Navigation parameters"],
  ["messages", "Prepared message parameters"],
  ["service", "Service parameters"],
] as const;

function Result({ result }: { result: EffectiveValues }) {
  return (
    <div className="flex flex-col gap-2">
      {groups.map(([key, title]) => {
        const group = result[key];
        return group === undefined ? null : (
          <details key={key} open={key === "channel" || key === "model"} className="rounded-key border border-line2">
            <summary className="cursor-pointer px-3 py-2 font-medium">{title}</summary>
            <ValueTable group={group} />
          </details>
        );
      })}
    </div>
  );
}

function ProblemCue({ id, problem, text }: { id?: string; problem: Problem; text: string }) {
  return (
    <div id={id} className="flex flex-wrap items-center gap-1 text-small">
      <span className={problem.level === "error" ? "text-fault" : "text-warn-ink"}>{text}</span>
      <Button size="xs" variant="ghost" onClick={() => openProblems(problem.id)}>View problem</Button>
    </div>
  );
}

function Inspection({ source, epochMs, queryEpochMs, onSeek, selected, onSelect }: {
  source: PreviewSource;
  epochMs: number;
  queryEpochMs: number;
  onSeek(value: number): void;
  selected?: SignalSelection | null;
  onSelect?: (target: SignalSelection) => void;
}) {
  const id = useId();
  const [epochDraft, setEpochDraft] = useState<{ initial: string; text: string } | null>(null);
  const first = source.range.first;
  const last = source.range.end - 1;
  const at = epochMs;
  const draftEpoch = epochDraft === null ? at : Number(epochDraft.text);
  const epochValid = epochDraft === null || (
    epochDraft.text.trim() !== "" && Number.isSafeInteger(draftEpoch) && draftEpoch >= first && draftEpoch <= last
  );
  const { target, update, bySignal, configured, available, capacity, valid, query } = useEffectiveInspection(source, queryEpochMs, selected, onSelect);
  const sampledEpochMs = query.kind === "ready" ? query.sampledEpochMs : queryEpochMs;
  const problemPrefix = `effective:${source.key}`;
  const location = source.origin === undefined ? source.label : `${source.origin} · ${source.label}`;
  const epochProblem = useMemo<Problem | null>(() => epochValid ? null : {
    id: `${problemPrefix}:epoch`, level: "warning", scope: "Effective values",
    title: "Invalid receiver epoch", message: `Enter an integer from ${first} to ${last} ms.`,
    location: `${location} · Epoch`,
  }, [epochValid, problemPrefix, first, last, location]);
  const satelliteProblem = useMemo<Problem | null>(() => valid ? null : {
    id: `${problemPrefix}:satellite`, level: "warning", scope: "Effective values",
    title: "Invalid satellite ID",
    message: capacity === undefined ? `Enter a positive integer satellite ID for ${target.system}.` : `Enter an integer ID from 1 to ${capacity} for ${target.system}.`,
    location: `${location} · Satellite ID`,
  }, [valid, problemPrefix, capacity, target.system, location]);
  useProblem(`${id}:epoch`, epochProblem);
  useProblem(`${id}:satellite`, satelliteProblem);

  const applyEpoch = () => {
    if (epochDraft === null) return;
    if (epochDraft.text !== epochDraft.initial) {
      if (!epochValid) return;
      onSeek(draftEpoch);
    }
    setEpochDraft(null);
  };

  return (
    <section aria-label="Effective values" className="@container flex min-w-0 flex-col gap-3">
      <div>
        <h3 className="m-0 text-title font-semibold" title="Model and navigation values at this epoch. Messages use their own validity intervals.">Effective values</h3>
        <p className="mt-1 mb-0 text-small text-ink2">{source.label} · {gpsClock(source.summary.window.startGpsMs + sampledEpochMs, true)} GPS</p>
      </div>
      <div className="grid grid-cols-2 items-start gap-3 @min-[560px]:grid-cols-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-epoch`} className="lab text-ink2">Epoch (ms)</label>
          <TextInput
            id={`${id}-epoch`} mono inputMode="numeric" value={epochDraft?.text ?? String(at)} aria-invalid={!epochValid}
            aria-describedby={!epochValid ? `${id}-epoch-message` : undefined}
            onFocus={() => setEpochDraft((draft) => draft ?? { initial: String(at), text: String(at) })}
            onChange={(e) => {
              const text = e.target.value;
              setEpochDraft((draft) => ({ initial: draft?.initial ?? String(at), text }));
            }}
            onBlur={applyEpoch}
            onKeyDown={(e) => {
              if (e.key === "Enter" && epochValid) {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEpochDraft(null);
              }
            }}
          />
          {epochProblem === null ? null : <ProblemCue id={`${id}-epoch-message`} problem={epochProblem} text="Invalid epoch." />}
        </div>
        <label className="flex flex-col gap-1">
          <span className="lab text-ink2">Constellation</span>
          <select
            className={`${fieldClass} ${focusRing}`} value={target.system}
            onChange={(e) => {
              const system = e.target.value as System;
              const configuredSignal = configured.find((candidate) => bySignal[candidate] === system);
              const signal = configuredSignal ?? signals.find((candidate) => bySignal[candidate] === system) ?? target.signal;
              update({ ...target, system, signal });
            }}
          >
            {systems.map((system) => <option key={system}>{system}</option>)}
          </select>
        </label>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-svid`} className="lab text-ink2">Satellite ID</label>
          <TextInput id={`${id}-svid`} mono inputMode="numeric" value={target.svid} aria-invalid={!valid} aria-describedby={!valid ? `${id}-svid-message` : undefined} onChange={(e) => update({ ...target, svid: e.target.value })} />
          {satelliteProblem === null ? null : <ProblemCue id={`${id}-svid-message`} problem={satelliteProblem} text="Invalid satellite ID." />}
        </div>
        <label className="flex flex-col gap-1">
          <span className="lab text-ink2">Signal</span>
          <select className={`${fieldClass} ${focusRing}`} value={target.signal} onChange={(e) => update({ ...target, signal: e.target.value as Signal })}>
            {available.map((signal) => <option key={signal}>{signal}</option>)}
          </select>
        </label>
      </div>
      {query.kind === "failed" ? (
        <ProblemCue problem={query.problem} text="Values unavailable." />
      ) : query.kind === "ready" ? (
        <>
          {query.pending ? <p role="status" className="m-0 text-small text-ink2">Showing epoch {query.sampledEpochMs} ms · updating to {queryEpochMs} ms…</p> : null}
          <Result result={query.result} />
        </>
      ) : query.kind === "loading" ? (
        <div role="status" className="flex items-center gap-2 text-ink2"><Spinner />Reading effective values…</div>
      ) : null}
    </section>
  );
}

export function EffectiveInspector({ frame, onSeek, onSelect }: {
  frame: PreviewFrame;
  onSeek(epochMs: number): void;
  onSelect?: (target: SignalSelection) => void;
}) {
  if (frame.source === null) return <p className="m-0 text-small text-ink2">{frame.owner.kind === "scenario" ? "Effective values available after scenario checks pass." : "Effective values need the run snapshot and command history."}</p>;
  const key = frame.source.identity.kind === "run" ? `${frame.ownerKey}:${JSON.stringify(frame.source.identity.run)}` : frame.ownerKey;
  return <Inspection key={key} source={frame.source} epochMs={frame.epochMs} queryEpochMs={frame.sampleEpochMs} onSeek={onSeek} selected={frame.selection} onSelect={onSelect} />;
}
