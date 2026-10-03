"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "@/core";
import { openProblems, type Problem } from "@/workbench/feedback";
import { useProblem } from "@/page/shared/feedback";
import { Button, closePopover, Fig, Icon, Popover, PopoverHead, TextInput, Toggle } from "@/page/shared/ui";
import { requestBasemapRemoval } from "@/workbench/basemaps";
import { addBasemap, basemapRefusalMessage, basemaps, setMapLabels } from "@/workbench/basemaps";
import type { Refusal } from "@/model/basemap";

function Row({ url, mark, children }: { url: string; mark: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-2 border-t border-line px-4 py-2">
      {mark}
      <code className="text-small [overflow-wrap:anywhere]">{url}</code>
      <Button variant="ghost" size="xs" aria-label={`Remove ${url}`} onClick={(e) => { closePopover(e.currentTarget); requestBasemapRemoval(url); }}>
        Remove
      </Button>
      <span className="col-start-2 col-end-4 text-small text-ink2">{children}</span>
    </div>
  );
}

export function BasemapPopover() {
  const owner = useId();
  const list = useStore(basemaps, (s) => s.list);
  const unopened = useStore(basemaps, (s) => s.unopened);
  const loaded = useStore(basemaps, (s) => s.loaded);
  const labels = useStore(basemaps, (s) => s.labels);
  const [address, setAddress] = useState("");
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState(false);
  const attempt = useRef(0);
  useEffect(() => () => { attempt.current++; }, []);
  const problem = useMemo<Problem | null>(() => refusal === null ? null : {
    id: "basemap:add", level: "error", scope: "Basemaps", title: "Could not add basemap",
    message: basemapRefusalMessage(refusal), location: address.trim(),
    actions: [{ id: "review-basemap", label: "Review basemap", run: () => document.getElementById("basemap")?.showPopover() }],
  }, [address, refusal]);
  useProblem(owner, problem);
  const add = async () => {
    const id = ++attempt.current;
    setBusy(true);
    setRefusal(null);
    const result = await addBasemap(address);
    if (id !== attempt.current) return;
    setBusy(false);
    setRefusal(result);
    if (result === null) setAddress("");
  };
  return (
    <Popover
      id="basemap"
      anchor="basemap-button"
      place="left"
      width={390}
      label="Basemap"
      onClose={() => {
        attempt.current++;
        setBusy(false);
      }}
    >
      <PopoverHead title="Basemap">
        <span>This browser</span>
      </PopoverHead>
      <div className="px-4 py-3">
        <Toggle checked={labels} onChange={setMapLabels}>
          Map labels
        </Toggle>
      </div>
      {list.map((b) => (
        <Row
          key={b.url}
          url={b.url}
          mark={
            <span className="text-ink3">
              <Icon name="layers" size={14} />
            </span>
          }
        >
          <Fig>{[`z${b.minZoom}–${b.maxZoom}`, b.attribution].filter(Boolean).join(" · ")}</Fig>
        </Row>
      ))}
      {unopened.map((u) => (
        <Row
          key={u.url}
          url={u.url}
          mark={
            <span className="text-warn-ink">
              <Icon name="warn" size={14} />
            </span>
          }
        >
          <span className="inline-flex items-center gap-2">
            <span className="text-warn-ink">Unavailable</span>
            <Button size="xs" variant="ghost" onClick={(e) => { closePopover(e.currentTarget); openProblems(`basemap:${u.url}:open`); }}>View problem</Button>
          </span>
        </Row>
      ))}
      <form
        className="flex flex-col gap-2 border-t border-line2 bg-panel px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <div className="flex gap-2">
          <TextInput
            data-autofocus
            mono
            className="flex-1"
            aria-label="Address of a .pmtiles archive"
            value={address}
            disabled={!loaded || busy}
            placeholder="http://127.0.0.1:8080/map.pmtiles"
            onChange={(e) => {
              setAddress(e.target.value);
              setRefusal(null);
            }}
          />
          <Button size="sm" type="submit" disabled={!loaded || busy || address.trim() === ""}>
            Add
          </Button>
        </div>
        {problem === null ? null : (
          <div className="flex items-center gap-2 text-small">
            <span className="text-fault">Could not add basemap</span>
            <Button size="xs" variant="ghost" onClick={(e) => { closePopover(e.currentTarget); openProblems(problem.id); }}>View problem</Button>
          </div>
        )}
      </form>
    </Popover>
  );
}
