"use client";

import { useState } from "react";
import { save } from "@/core";
import { downloadSubmissionAsset } from "@/workbench/hosts/actions";
import type { SubmissionRecord } from "@/model/host";
import { sourceWords } from "@/workbench/hosts";
import { Button, Softkeys } from "@/page/shared/ui";

function safeName(name: string): string {
  return name.split(/[\\/]/).at(-1) || "submission";
}

function saveText(text: string, name: string): void {
  save(new Blob([text], { type: "application/json" }), name);
}

export function SubmissionSnapshot({ submission }: { submission: SubmissionRecord }) {
  const [file, setFile] = useState<"scenario" | "trajectory">("scenario");
  const texts = submission.texts;
  const text = file === "scenario" ? texts.scenario : texts.source.text;
  const stem = `${safeName(submission.source.scenarioId)}-v${submission.source.versionNumber}`;
  const assets = Object.entries(texts.files);
  const generated = texts.generated;
  if (!assets.some(([name, digest]) => name === generated.name && digest === generated.digest)) assets.push([generated.name, generated.digest]);
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-key border border-line2 bg-face p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 font-semibold">Snapshot · {sourceWords(submission.source)}</h3>
        <span className="flex-1" />
        <Button size="sm" icon="download" onClick={() => save(new Blob([submission.bundle], { type: "application/octet-stream" }), `${stem}.phb`)}>Bundle</Button>
        <Button size="sm" icon="download" onClick={() => saveText(text, `${file}.json`)}>Download JSON</Button>
      </div>
      <Softkeys<"scenario" | "trajectory">
        label="Run snapshot source"
        value={file}
        onChange={setFile}
        options={[["scenario", "Scenario"], ["trajectory", "Trajectory"]]}
        className="self-start"
      />
      <textarea
        aria-label={`Run snapshot ${file} JSON, read-only`}
        spellCheck={false}
        readOnly
        value={text}
        className="h-72 w-full resize-y rounded-key border border-line2 bg-display p-3 font-mono text-small leading-5 outline-none focus:border-ink"
      />
      <p className="m-0 text-small text-ink3 [overflow-wrap:anywhere]">Bundle SHA-256 <code>{submission.digest}</code></p>
      {assets.length === 0 ? null : (
        <section className="text-small">
          <h4 className="m-0 pb-2 font-semibold">Input files</h4>
          <ul className="m-0 list-none p-0">
            {assets.map(([name, digest]) => <li key={`${name}:${digest}`} className="flex items-center gap-3 border-t border-line py-1.5">
              <span className="min-w-0 flex-1 font-mono [overflow-wrap:anywhere]">{name}</span>
              <Button size="xs" icon="download" onClick={() => void downloadSubmissionAsset(submission, name, digest)}>Download</Button>
            </li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
