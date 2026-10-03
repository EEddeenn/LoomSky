import type { ResourcePreview } from "@/workbench/library/preview";
import { MapView } from "@/page/shared/preview/map";
import { scenarioOutputsText } from "../../documents/scenario-summary";
import { addedOn, PreviewFacts, PreviewHeader, PreviewIssues, PreviewList, PreviewSection, PreviewUnavailable } from "../info";

const tones = { normal: "text-ink2", warning: "text-warn-ink", error: "text-fault", active: "text-rf-ink" };

export function ResourceDetails({ resourceKey, preview }: { resourceKey: string; preview: ResourcePreview | null }) {
  if (preview === null) return <PreviewUnavailable />;
  return <>
    <PreviewHeader title={preview.title} kind={preview.kind} description={preview.description} />
    {preview.scene === null ? null : <figure className="m-0 border-b border-line">
      <div className="grid h-[250px] min-h-[200px]"><MapView viewKey={`library:${resourceKey}`} variant="preview" scene={preview.scene} label={`${preview.title} trajectory preview`} /></div>
      <figcaption className="px-4 py-2 text-small text-ink3 [overflow-wrap:anywhere]">{preview.mapCaption}</figcaption>
    </figure>}
    <div className="flex min-w-0 flex-col gap-5 p-4">
      <div className={`text-small font-medium ${tones[preview.status.tone]}`}>{preview.status.text}</div>
      {preview.mapNote === null ? null : <p className="m-0 text-small text-ink3">{preview.mapNote}</p>}
      <PreviewFacts facts={[...preview.facts.map((fact) => "kind" in fact ? ["Output", scenarioOutputsText(fact.outputs)] as const : fact), ...(preview.created === null ? [] : [["Created", addedOn(preview.created)] as const])]} />
      <PreviewIssues issues={preview.issues} />
      {preview.relations.map((relation) => <PreviewSection key={relation.title} title={relation.title}><PreviewList items={relation.items} /></PreviewSection>)}
    </div>
  </>;
}
