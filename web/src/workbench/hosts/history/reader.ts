"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getRunKnowledge, getSubmission, loadSubmissions, onStorageChanges } from "@/io/storage";
import { extendsSubmissionTruth, sameSubmissionSource, type SubmissionIdentity, type SubmissionRecord } from "@/model/host";
import type { Host } from "../state";
import { hostView } from "../display";

const selectedRuns = new Map<string, string>();

function matches(record: SubmissionRecord, identity: SubmissionIdentity): boolean {
  return record.address === identity.address && record.boot === identity.boot && record.run === identity.run && record.digest === identity.digest
    && sameSubmissionSource(record.source, identity.source);
}

function newerTruth(record: SubmissionRecord, previous?: SubmissionRecord): SubmissionRecord {
  return previous?.truth !== undefined && matches(record, previous) && (record.truth === undefined || !extendsSubmissionTruth(record.truth, previous.truth))
    ? { ...record, truth: previous.truth } : record;
}

export function useRunHistory(host: Host) {
  const [stored, setStored] = useState<SubmissionRecord[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(() => selectedRuns.get(host.key) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const request = useRef<(() => Promise<void>) | null>(null);
  const refresh = useCallback(async () => { await request.current?.(); }, []);

  useEffect(() => {
    let active = true;
    let pending: Promise<void> | null = null;
    let requested: Set<string> | null = null;
    let records = new Map<string, SubmissionRecord>();
    const read = async (key: string): Promise<SubmissionRecord | undefined> => {
      const previous = records.get(key);
      if (previous === undefined) return getSubmission(key);
      const knowledge = await getRunKnowledge(key);
      if (knowledge === undefined || !matches(previous, knowledge.identity)) return active ? getSubmission(key) : undefined;
      return knowledge.truth === null ? previous : newerTruth({ ...previous, truth: knowledge.truth }, previous);
    };
    const load = (key?: string): Promise<void> => {
      if (!active) return Promise.resolve();
      if (key === undefined) requested = null;
      else requested?.add(key);
      if (pending !== null) return pending;
      if (requested === null) setLoading(true);
      setError(null);
      pending = Promise.resolve().then(async () => {
        try {
          while (active && (requested === null || requested.size > 0)) {
            const keys = requested;
            requested = new Set();
            const loaded = keys === null
              ? (await loadSubmissions()).map((record) => [record.key, record] as const)
              : await Promise.all([...keys].map(async (key) => [key, await read(key)] as const));
            if (!active) return;
            const previous = records;
            if (keys === null) records = new Map();
            for (const [key, record] of loaded) {
              if (record === undefined || record.address !== host.record.address) records.delete(key);
              else records.set(key, newerTruth(record, previous.get(key)));
            }
            setStored([...records.values()].toSorted((a, b) => b.at - a.at));
            setError(null);
          }
        } catch (reason) {
          if (active) {
            requested = null;
            setError(reason instanceof Error ? reason.message : String(reason));
          }
        } finally {
          pending = null;
          if (active) setLoading(false);
        }
      });
      return pending;
    };
    request.current = load;
    setSelectedKey(selectedRuns.get(host.key) ?? null);
    const unsubscribe = onStorageChanges((change) => {
      if (change === null) void load();
      else if (change.scope === "submissions" && change.key.startsWith(`${host.record.address} `)) void load(change.key);
    });
    void load();
    return () => {
      if (request.current === load) request.current = null;
      active = false;
      unsubscribe();
    };
  }, [host]);

  const matching = stored.filter((record) => record.address === host.record.address);
  const live = hostView(host, Date.now()).submission;
  const current = live === null ? null : newerTruth(live, matching.find((record) => record.key === live.key));
  const records = current === null
    ? matching
    : [current, ...matching.filter((record) => record.key !== current.key)].toSorted((a, b) => b.at - a.at);
  const selected = records.find((record) => record.key === selectedKey) ?? records[0] ?? null;
  return {
    current, records, selected, error, loading, waiting: loading && matching.length === 0,
    refresh,
    select: (key: string) => {
      selectedRuns.set(host.key, key);
      setSelectedKey(key);
    },
  };
}
