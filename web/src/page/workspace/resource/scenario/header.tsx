"use client";

import { useStore } from "@/core";
import { airingHosts, chipLabel, hostView, hosts, nameOf } from "@/workbench/hosts";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import { documentView, page, setView } from "@/workbench/navigation";
import { openProblems } from "@/workbench/feedback";
import { useNow } from "@/workbench/clock";
import { openTransmit } from "@/workbench/transmit";
import { scenarioPreviewSession } from "@/workbench/preview";
import { CheckSummary } from "@/page/shared/feedback";
import { NavLink } from "@/page/shared/navigation";
import { Button, Icon, Softkeys } from "@/page/shared/ui";
import { DocumentSaveStatus, SaveDocumentButton, useDocumentSaveState } from "@/page/shared/documents/versions";

const hostLooks = {
  onair: "bg-rf text-on-rf",
  armed: "bg-face shadow-[inset_0_0_0_2px_var(--rf-mark)]",
  unknown: "bg-face outline-2 -outline-offset-2 outline-dashed outline-rf-mark",
  alarm: "bg-face outline-2 -outline-offset-2 outline-fault",
  off: "bg-face outline-2 -outline-offset-2 outline-fault",
};
const hostIcons = { armed: "clock", unknown: "unknown", alarm: "alert", off: "alert" } as const;

function Airing({ doc }: { doc: ScenarioDoc }) {
  const now = useNow();
  useStore(hosts, (s) => s.list);
  const list = airingHosts(doc.id, now);
  if (list.length === 0) return null;
  const old = list.filter((h) => {
    const submission = hostView(h, now).submission;
    return submission !== null && (submission.source.versionId !== doc.saved.version.id || doc.hasUnsavedChanges);
  });
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-ink2">
        {list.map((h) => {
          const name = nameOf(h);
          const { cls, chip } = hostView(h, now);
          return (
            <NavLink
              key={h.key}
              aria-label={chipLabel(name, chip)}
              resource={{ kind: "host", key: h.key }}
              className={`inline-flex h-6 items-center gap-1 rounded-key px-2 text-small font-semibold whitespace-nowrap ${hostLooks[cls]}`}
            >
              {cls === "onair" ? (
                <span className="inline-block size-[7px] rounded-full bg-on-rf" />
              ) : (
                <span className={cls === "alarm" || cls === "off" ? "text-fault" : "text-rf-ink"}>
                  <Icon name={hostIcons[cls]} size={12} />
                </span>
              )}
              {name}
            </NavLink>
          );
        })}
      </div>
      {old.length > 0 ? (
        <button type="button" className="inline-flex items-center gap-1.5 text-small text-warn-ink" onClick={() => openProblems(`scenario:${doc.id}:airing-revision`)}>
          <Icon name="warn" size={14} /><span className="underline underline-offset-3">Working copy differs</span>
        </button>
      ) : null}
    </>
  );
}

export function ScenarioTools({ doc }: { doc: ScenarioDoc }) {
  const view = useStore(page, (s) => documentView(s.route));
  const { dirty, pending, unapplied, saving, conflict } = useDocumentSaveState(doc);
  const save = dirty || pending > 0 || unapplied;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Softkeys label="View" options={[["form", "Form"], ["json", "JSON"]]} value={view} onChange={setView} />
      <SaveDocumentButton doc={doc} />
      <Button size="sm" icon="send" disabled={saving || conflict} onClick={() => openTransmit({ scenario: doc.id, replayFromMs: scenarioPreviewSession(doc).get().epochMs, ...(save ? { save: true } : {}) })}>{save ? "Save & review…" : "Transmit…"}</Button>
    </div>
  );
}

export function ScenarioStatus({ doc }: { doc: ScenarioDoc }) {
  return (
    <>
      <CheckSummary docId={doc.id} status={doc.editor.status} diagnostics={doc.editor.diagnostics} />
      <DocumentSaveStatus doc={doc} />
      <Airing doc={doc} />
    </>
  );
}
