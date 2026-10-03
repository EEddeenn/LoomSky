"use client";

import { useId, useState } from "react";
import { useStore } from "@/core";
import { resourceKey, type ResourceRef } from "@/model/resource";
import { copyScenario, downloadScenario, removeScenario } from "@/workbench/documents/scenario/actions";
import { copyTrajectory, downloadTrajectoryPht, downloadTrajectorySource, removeTrajectory } from "@/workbench/documents/trajectory/actions";
import { downloadLibraryFile, requestLibraryFileRemoval } from "@/workbench/files/actions";
import { removeHost } from "@/workbench/hosts/actions";
import { openScenario, scenarioCatalog, type ScenarioDoc } from "@/workbench/documents/scenario";
import { openTrajectory, type TrajectoryDoc } from "@/workbench/documents/trajectory";
import { canStop, hostOf, stopText } from "@/workbench/hosts";
import { stopHost } from "@/workbench/hosts/actions";
import { captureAttention, navigate, openResource, type AttentionToken } from "@/workbench/navigation";
import { openTransmit } from "@/workbench/transmit";
import { libraryFileOf, renameLibraryFile } from "@/workbench/files";

import { reportProblem, resolveProblem } from "@/workbench/feedback";
import { Button, closePopover, Popover, PopoverBody, PopoverFooter, PopoverHead, TextInput } from "@/page/shared/ui";

export function ResourceActions({ resource, name: resourceName, mode = "list", returnScenario }: { resource: ResourceRef; name: string; mode?: "list" | "detail"; returnScenario?: string }) {
  const uid = useId();
  const menu = `${uid}-menu`;
  const anchor = `${uid}-actions`;
  const rename = `${uid}-rename`;
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(resourceName);
  const [renameRevision, setRenameRevision] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const working = useStore(scenarioCatalog, (state) => resource.kind === "scenario" ? state.entries.get(resource.id)?.working ?? null : null);
  const host = resource.kind === "host" ? hostOf(resource.key) : undefined;
  const problemId = `library:action:${resourceKey(resource)}`;
  const action = async (run: () => unknown | Promise<unknown>, blocking = true) => {
    if (busy) return;
    if (blocking) setBusy(true);
    try {
      if (await run() !== false) resolveProblem(problemId);
    } catch (error) {
      reportProblem({
        id: problemId, level: "error", scope: resourceName,
        title: "Action failed", message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (blocking) setBusy(false);
    }
  };
  const withScenario = async (run: (doc: ScenarioDoc, attention: AttentionToken) => unknown | Promise<unknown>) => {
    if (resource.kind !== "scenario") return false;
    const attention = captureAttention();
    return run(await openScenario(resource.id), attention);
  };
  const withTrajectory = async (run: (doc: TrajectoryDoc, attention: AttentionToken) => unknown | Promise<unknown>) => {
    if (resource.kind !== "trajectory") return false;
    const attention = captureAttention();
    return run(await openTrajectory(resource.id), attention);
  };
  const item = (label: string, run: () => unknown | Promise<unknown>, disabled = false, operation = false) => (
    <button
      type="button"
      role="menuitem"
      disabled={busy || disabled}
      onClick={(event) => { closePopover(event.currentTarget); void action(run, !operation); }}
      className="w-full px-3 py-2 text-left hover:bg-hover disabled:opacity-45"
    >
      {label}
    </button>
  );
  const saveBeforeTransmit = working !== null && (working.dirty || working.pending);
  return (
    <div className="flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      {resource.kind !== "scenario" || mode === "detail" ? null : (
        <Button size="xs" variant="ghost" icon="send" iconOnly={!saveBeforeTransmit} aria-label={`${saveBeforeTransmit ? "Save & review" : "Transmit"} ${resourceName}`} title={saveBeforeTransmit ? "Save & review transmission" : "Transmit saved version"} disabled={busy} onClick={() => void action(() => openTransmit({ scenario: resource.id, save: saveBeforeTransmit }))}>
          {saveBeforeTransmit ? "Save & review" : null}
        </Button>
      )}
      {host === undefined || !canStop(host, Date.now()) ? null : <Button size="xs" variant="danger" title={stopText(host) || "Stop transmission"} onClick={() => stopHost(host.key)}>Stop</Button>}
      <Button id={anchor} size="xs" variant="ghost" icon="dots" iconOnly aria-label={`Actions for ${resourceName}`} popoverTarget={menu} disabled={busy} />
      <Popover id={menu} anchor={anchor} width={210} role="menu" label={`Actions for ${resourceName}`}>
        {mode === "detail" ? null : item("Open", () => openResource(resource))}
        {resource.kind !== "scenario" ? null : (
          <>
            {item("Duplicate", () => withScenario(copyScenario), false, true)}
            {item("Export…", () => withScenario(downloadScenario), false, true)}
            {item("Delete…", () => withScenario(removeScenario))}
          </>
        )}
        {resource.kind !== "trajectory" ? null : (
          <>
            {item("Duplicate", () => withTrajectory((doc, attention) => copyTrajectory(doc, returnScenario, attention)), false, true)}
            {item("Export trajectory JSON", () => withTrajectory(downloadTrajectorySource), false, true)}
            {item("Export PHT", () => withTrajectory(downloadTrajectoryPht), false, true)}
            {item("Delete…", () => withTrajectory(removeTrajectory))}
          </>
        )}
        {resource.kind !== "file" ? null : (
          <>
            <button
              type="button"
              role="menuitem"
              className="w-full px-3 py-2 text-left hover:bg-hover"
              onClick={(event) => {
                closePopover(event.currentTarget);
                const file = libraryFileOf(resource.id);
                setName(file?.name ?? resourceName);
                setRenameRevision(file?.revision ?? null);
                setError(file === undefined ? "This file is no longer in Library." : null);
                document.getElementById(rename)?.showPopover();
              }}
            >
              Rename…
            </button>
            {item("Export", () => downloadLibraryFile(resource.id), false, true)}
            {item("Remove from Library…", () => requestLibraryFileRemoval(resource.id))}
          </>
        )}
        {host === undefined ? null : (
          <>
            {item("Device", () => navigate({ workspace: "resource", kind: "host", id: host.key, tab: "device" }))}
            {item("Remove connection…", () => removeHost(host.key))}
          </>
        )}
      </Popover>
      {resource.kind !== "file" ? null : (
        <Popover id={rename} anchor={anchor} width={340} label="Rename file">
          <PopoverHead title="Rename file" />
          <form onSubmit={(event) => {
            event.preventDefault();
            if (busy || name.trim() === "" || renameRevision === null) return;
            const form = event.currentTarget;
            setBusy(true);
            setError(null);
            void renameLibraryFile(resource.id, name.trim(), renameRevision)
              .then(() => closePopover(form), (error: unknown) => setError(error instanceof Error ? error.message : String(error)))
              .finally(() => setBusy(false));
          }}>
            <PopoverBody>
              <label className="lab text-ink2" htmlFor={`${uid}-name`}>File name</label>
              <TextInput id={`${uid}-name`} data-autofocus value={name} disabled={busy} onChange={(event) => setName(event.target.value)} />
              {error === null ? null : <p className="m-0 text-small text-fault">{error}</p>}
            </PopoverBody>
            <PopoverFooter>
              <Button size="sm" variant="ghost" disabled={busy} onClick={(event) => closePopover(event.currentTarget)}>Cancel</Button>
              <span className="flex-1" />
              <Button size="sm" type="submit" variant="primary" disabled={busy || name.trim() === "" || renameRevision === null}>{busy ? "Saving…" : "Rename"}</Button>
            </PopoverFooter>
          </form>
        </Popover>
      )}
    </div>
  );
}
