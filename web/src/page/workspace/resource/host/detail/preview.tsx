"use client";

import type { Host } from "@/workbench/hosts";
import { Band } from "@/page/shared/preview/band";
import { EffectiveInspector } from "@/page/shared/preview/effective";
import { PreviewMap } from "@/page/shared/preview/scene";
import { usePreviewView } from "@/page/shared/preview/use-preview-view";
import { page, setCommand } from "@/workbench/navigation";
import { useHostPreviewSession } from "@/workbench/preview";
import { Icon } from "@/page/shared/ui";
import { ScrollArea } from "../scroll";
import { EffectivePanel } from "./effective";

export function HostPreview({ host }: { host: Host }) {
  const { session, frame } = useHostPreviewSession(host);
  const viewport = usePreviewView(session);
  return (
    <ScrollArea pane="preview" className="flex flex-col">
      <div className="flex items-start gap-2 border-b border-line bg-panel px-5 py-3 text-small text-ink2">
        <Icon name="info" size={14} />
        <span>
          {frame.source === null ? "Run snapshot unavailable in this browser." : `Modeled signal: ${frame.source.label}, with applied commands.`} Sky and C/N0 are modeled. See Run for hardware status.
          {frame.note === null ? null : <span className="mt-1 block text-warn-ink">{frame.note.message}</span>}
        </span>
      </div>
      <div className="relative grid min-h-80 flex-1"><PreviewMap frame={frame} session={session} viewport={viewport} /></div>
      <Band frame={frame} onSeek={session.seek} onSelect={session.select} onCommand={(selection) => {
        session.select(selection);
        const command = page.get().command;
        setCommand({ kind: "power", system: selection.system, svid: String(selection.svid), unit: command.unit === "scenario" ? "dbhz" : command.unit, focus: command.focus + 1 });
      }} />
      <EffectivePanel id={`host:${host.key}:effective`}><EffectiveInspector frame={frame} onSeek={session.seek} onSelect={session.select} /></EffectivePanel>
    </ScrollArea>
  );
}
