"use client";

import { displayOrder, gpsClock, gpsDate, type System } from "@/model/gnss";
import type { Coverage } from "@/io/pharos";
import { scenarioIssues, type ScenarioFileField } from "@/model/scenario";
import { Messages } from "@/page/shared/documents/editor";
import { diagnosticsAt } from "@/model/document";
import { Button, Fig } from "@/page/shared/ui";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import { schemas } from "@/workbench/schemas";
import { addScenarioFiles } from "@/workbench/documents/scenario/actions";
import { FileRow } from "./file-row";

export function FileChips({ doc, keyName, accept, multiple = true }: { doc: ScenarioDoc; keyName: ScenarioFileField | "precise"; accept?: string; multiple?: boolean }) {
  const keys: ScenarioFileField[] = keyName === "precise" ? ["precise.orbit", "precise.clock"] : [keyName];
  const references = keys.flatMap((key) => doc.references(key));
  const diagnostics = diagnosticsAt(doc.editor, keyName.split("."));
  const issues = scenarioIssues(doc, schemas.get().scenario);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-col gap-2">
        {references.map((reference) => {
          const { name } = reference;
          const described = keyName === "ephemeris" ? doc.view?.described.get(name) : undefined;
          return (
            <FileRow key={JSON.stringify(reference.path)} doc={doc} reference={reference} issues={issues} accept={accept} label={keyName === "precise" ? reference.key === "precise.orbit" ? "Orbit" : "Clock" : undefined}>
              {described !== undefined && "coverage" in described ? <NavDescription coverage={described.coverage} /> : null}
            </FileRow>
          );
        })}
      </div>
      <div className={`flex flex-wrap items-center gap-2 rounded-key border border-dashed px-3 py-2 ${diagnostics.some((d) => d.error) ? "border-fault" : "border-line2"}`}>
        {references.length === 0 ? <span className="text-small text-ink3">No files selected</span> : null}
        {keys.map((key) => <Button key={key} size="xs" icon="folder" className="ml-auto" disabled={!doc.editor.writable()} onClick={() => addScenarioFiles(doc, key, accept)}>
          {keyName === "precise" ? `Add ${key === "precise.orbit" ? "orbit" : "clock"} file…` : multiple ? "Add from Library…" : "Choose from Library…"}
        </Button>)}
      </div>
      {keyName === "precise" ? null : <Messages doc={doc.editor} diagnostics={diagnostics} />}
    </div>
  );
}

function NavDescription({ coverage }: { coverage: Coverage[] }) {
  if (coverage.length === 0) return <span className="text-small text-ink2">No supported ephemeris coverage</span>;
  const bySystem = new Map<System, number>();
  for (const c of coverage) {
    bySystem.set(c.system, Math.max(bySystem.get(c.system) ?? 0, c.satellites.length));
  }
  const from = Math.min(...coverage.map((c) => c.fromGpsMs));
  const until = Math.max(...coverage.map((c) => c.untilGpsMs));
  return (
    <>
      <span className="text-small text-ink2">
        <Fig>{displayOrder.flatMap((s) => (bySystem.has(s) ? [`${s} ${bySystem.get(s)}`] : [])).join(" · ")}</Fig>
      </span>
      <span className="text-small text-ink2 [overflow-wrap:anywhere]">
        <Fig>{`${gpsDate(from)} ${gpsClock(from)} → ${gpsDate(from) === gpsDate(until) ? "" : `${gpsDate(until)} `}${gpsClock(until)} GPS`}</Fig>
      </span>
    </>
  );
}
