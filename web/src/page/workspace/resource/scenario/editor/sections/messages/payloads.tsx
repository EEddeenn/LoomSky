"use client";

import { useStore } from "@/core";
import { scenarioIssues } from "@/model/scenario";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import { schemas } from "@/workbench/schemas";
import { setScenarioPreview } from "@/workbench/navigation";
import { openProblems } from "@/workbench/feedback";
import { Button, FeedbackIcon } from "@/page/shared/ui";
import { useSchema } from "@/page/shared/documents/editor";
import { PublicationList } from "@/page/workspace/resource/scenario/editor/fields";
import { D2Publication } from "./d2";
import { GpsPublication } from "./gps";
import { InavPublication } from "./inav";

export function PayloadsSection({ doc }: { doc: ScenarioDoc }) {
  const rules = useSchema(doc.editor, ["messages"]).node?.["x-publication"];
  const schema = useStore(schemas, (state) => state);
  const issue = scenarioIssues(doc, schema.scenario).find((item) => item.kind === "publication-rules");
  if (rules === undefined) {
    return schema.status === "loading" ? (
      <p className="m-0 text-small text-ink3">Loading publication rules…</p>
    ) : (
      <button type="button" className="inline-flex self-start items-center gap-1 text-small text-fault" onClick={() => openProblems(schema.status === "error" ? "document:schema:load" : issue?.id)}>
        <FeedbackIcon level="error" size={14} />
        <span className="underline underline-offset-3">Rules unavailable</span>
      </button>
    );
  }
  const samples = doc.editor.value(["samples"]);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex justify-end">
        <Button size="xs" onClick={() => setScenarioPreview({ view: "effective" })}>Effective values</Button>
      </div>
      {samples === undefined ? <p className="m-0 text-small text-ink2">Enable sample output to use these publications.</p> : null}
      <p className="m-0 text-small text-ink3">Each [from, until) interval is complete. Gaps and omitted payloads inherit nothing.</p>
      <PublicationList doc={doc} family="gps" label="GPS · LNAV / CNAV / CNAV-2">
        {(path) => <GpsPublication doc={doc} path={path} rules={rules.gps} />}
      </PublicationList>
      <PublicationList doc={doc} family="inav" label="Galileo I/NAV">
        {(path) => <InavPublication doc={doc} path={path} rules={rules.inav} />}
      </PublicationList>
      <PublicationList doc={doc} family="d2" label="BDS D2 · GEO augmentation">
        {(path) => <D2Publication doc={doc} path={path} rules={rules.d2} />}
      </PublicationList>
    </div>
  );
}
