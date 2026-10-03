import { useEffect, useId, useMemo, useState } from "react";
import { gpsClock, isSignal, isSystem, signals, type Signal, type System } from "@/model/gnss";
import { listOf, parseRecord, useStore } from "@/core";
import { compute } from "@/io/compute";
import type { EffectiveQuery } from "@/model/observation";
import type { PreviewSource, SignalSelection } from "@/model/preview";
import { systemsOf } from "@/model/schema";
import { replaceProblems, type Problem } from "@/workbench/feedback";
import { schemas } from "@/workbench/schemas";
import { commandInputs } from "@/model/observation/query-key";
import { useLatestQuery } from "./query";

type Target = { system: System; svid: string; signal: Signal };
function useQuery(source: PreviewSource, query: EffectiveQuery | null) {
  const owner = useId();
  const scope = query === null ? null : JSON.stringify([
    source.digest, source.run, commandInputs(source.commands), query.system, query.svid, query.signal, query.groups ?? null,
  ]);
  const { reading, error, pending, retry } = useLatestQuery(scope, query?.epoch ?? 0, async (signal) => {
    if (query === null) throw new Error("Effective query required.");
    return compute.obs.inspect({
      digest: source.digest, source: async () => source.bundle, run: source.run, commands: source.commands, query,
    }, { signal });
  });
  const problem = useMemo<Problem | null>(() => error === null || query === null ? null : {
    id: `effective:${source.key}:query`, level: "error", scope: "Effective values",
    title: "Could not read effective values", message: error,
    location: `${source.origin === undefined ? source.label : `${source.origin} · ${source.label}`} · ${query.system} ${query.svid} · ${query.signal} · epoch ${query.epoch} ms (${gpsClock(source.summary.window.startGpsMs + query.epoch, true)} GPS)`,
    actions: [{ id: "retry-query", label: "Retry query", run: retry }],
  }, [error, source, query?.epoch, query?.system, query?.svid, query?.signal, retry]);
  useEffect(() => { replaceProblems(owner, problem === null ? [] : [problem]); }, [owner, problem]);
  useEffect(() => () => replaceProblems(owner, []), [owner]);
  if (query === null) return { kind: "idle" } as const;
  if (problem !== null) return { kind: "failed", problem } as const;
  if (reading === null) return { kind: "loading" } as const;
  return { kind: "ready", result: reading.value, sampledEpochMs: reading.epochMs, pending } as const;
}

export function useEffectiveInspection(source: PreviewSource, epochMs: number, selected?: SignalSelection | null, onSelect?: (target: SignalSelection) => void) {
  const schema = useStore(schemas, (state) => state.scenario);
  const bySignal = systemsOf(schema?.properties?.signals ?? null);
  const configured = useMemo(() => listOf(parseRecord(source.scenario).signals).filter(isSignal), [source.scenario]);
  const [draft, setDraft] = useState<{ selection: SignalSelection | null | undefined; target: Target }>(() => {
    const signal = configured[0] ?? "L1CA";
    const system = bySignal[signal];
    return { selection: undefined, target: isSystem(system) ? { system, svid: "1", signal } : { system: "GPS", svid: "1", signal: "L1CA" } };
  });
  const target = selected !== null && selected !== undefined && draft.selection !== selected ? {
    system: selected.system,
    svid: String(selected.svid),
    signal: selected.signal
      ?? configured.find((signal) => bySignal[signal] === selected.system)
      ?? signals.find((signal) => bySignal[signal] === selected.system)
      ?? draft.target.signal,
  } : draft.target;
  useEffect(() => {
    if (draft.selection === selected) return;
    setDraft({ selection: selected, target });
  }, [selected]);
  const options = signals.filter((signal) => bySignal[signal] === target.system);
  const available = options.length === 0 ? signals : options;
  const svid = /^\d+$/.test(target.svid.trim()) ? Number(target.svid) : NaN;
  const capacity = schema?.["x-satellite-capacity"]?.[target.system];
  const valid = Number.isSafeInteger(svid) && svid > 0 && (capacity === undefined || svid <= capacity);
  const query = useQuery(source, valid ? { epoch: epochMs, system: target.system, svid, signal: target.signal } : null);

  return {
    target,
    update: (next: Target) => {
      setDraft({ selection: selected, target: next });
      const svid = /^\d+$/.test(next.svid.trim()) ? Number(next.svid) : NaN;
      const capacity = schema?.["x-satellite-capacity"]?.[next.system];
      if (Number.isSafeInteger(svid) && svid > 0 && (capacity === undefined || svid <= capacity)) {
        onSelect?.({ system: next.system, svid, signal: next.signal });
      }
    },
    bySignal,
    configured,
    available,
    capacity,
    valid,
    query,
  };
}
