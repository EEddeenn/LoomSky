"use client";

import { useId } from "react";
import { Button, closePopover, Popover, type IconName } from "@/page/shared/ui";
import type { TrajectoryDoc } from "@/workbench/documents/trajectory";
import type { EditOutcome, TrajectorySession } from "@/workbench/documents/trajectory/editing";

const mapTools = [
  { value: "select", label: "Select", title: "Select an object" },
  { value: "point", label: "Add point", title: "Click the map to add a point" },
] as const;

const moreTools = [
  { value: "curve", label: "Guide curve", title: "Draw a guide curve" },
  { value: "region", label: "Region", title: "Draw a region" },
  { value: "direction", label: "Direction", title: "Set the selected event’s direction" },
] as const;

const dragModes = [
  { value: "target", label: "Target", title: "Sets a preferred value the solver may adjust" },
  { value: "hard", label: "Hard", title: "Sets a required value" },
  { value: "initial", label: "Initial guess", title: "Sets the solver’s initial guess" },
] as const;

function PanelToggle({ label, icon, open, onClick }: { label: string; icon: IconName; open: boolean; onClick(): void }) {
  return (
    <Button size="sm" variant="ghost" icon={icon} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} ${label.toLowerCase()}`} title={`${open ? "Hide" : "Show"} ${label.toLowerCase()}`} className={open ? "bg-hover text-ink" : ""} onClick={onClick}>
      {label}
    </Button>
  );
}

export function TrajectoryToolbar({ doc, session, state, charts, onToggleCharts, onOutcome }: {
  doc: TrajectoryDoc;
  session: TrajectorySession;
  state: ReturnType<TrajectorySession["get"]>;
  charts: boolean;
  onToggleCharts(): void;
  onOutcome(outcome: EditOutcome): void;
}) {
  const uid = useId();
  const anchor = `${uid}-add`;
  const menu = `${uid}-menu`;
  const editable = doc.editor.writable();
  const activeTool = moreTools.find((tool) => tool.value === state.tool);
  return (
    <div className="flex min-h-10 flex-none flex-wrap items-center gap-x-2 gap-y-1 border-b border-line2 bg-panel px-2 py-1">
      <div role="group" aria-label="Map tool" className="inline-flex rounded-key bg-face ring-key">
        {mapTools.map((tool) => (
          <button key={tool.value} type="button" title={tool.title} aria-pressed={state.tool === tool.value} disabled={!editable && tool.value !== "select"} onClick={() => session.setTool(tool.value)} className={`h-7 px-2 text-small font-medium whitespace-nowrap first:rounded-l-key last:rounded-r-key disabled:opacity-45 ${state.tool === tool.value ? "bg-sel text-on-sel" : "text-ink2 enabled:hover:bg-hover enabled:hover:text-ink"}`}>
            {tool.label}
          </button>
        ))}
      </div>
      <Button id={anchor} size="sm" variant="ghost" icon="plus" popoverTarget={menu} disabled={!editable} className={activeTool === undefined ? "" : "bg-sel text-on-sel"}>{activeTool?.label ?? "Add…"}</Button>
      <Popover id={menu} anchor={anchor} width={200} role="menu" label="Add trajectory object">
        {moreTools.map((tool) => (
          <button key={tool.value} type="button" role="menuitem" title={tool.title} disabled={!editable} onClick={(event) => { closePopover(event.currentTarget); session.setTool(tool.value); }} className="w-full px-3 py-2 text-left text-small hover:bg-hover disabled:opacity-45">{tool.label}</button>
        ))}
        <div role="separator" className="border-t border-line2" />
        <button type="button" role="menuitem" disabled={!editable} onClick={(event) => { closePopover(event.currentTarget); onOutcome(session.addEvent()); }} className="w-full px-3 py-2 text-left text-small hover:bg-hover disabled:opacity-45">Event</button>
        <button type="button" role="menuitem" disabled={!editable} onClick={(event) => { closePopover(event.currentTarget); onOutcome(session.addRule()); }} className="w-full px-3 py-2 text-left text-small hover:bg-hover disabled:opacity-45">Rule</button>
      </Popover>
      {state.selected?.kind === "event" || state.tool === "direction" ? (
        <label className="flex items-center gap-1.5 text-micro text-ink3">
          Drag sets
          <select aria-label="Drag behavior" value={state.dragMode} disabled={!editable} onChange={(event) => session.setDragMode(event.target.value as typeof state.dragMode)} className="h-7 rounded-key bg-face px-1.5 text-small text-ink ring-key disabled:opacity-45">
            {dragModes.map((mode) => <option key={mode.value} value={mode.value} title={mode.title}>{mode.label}</option>)}
          </select>
        </label>
      ) : null}
      <div className="ml-auto flex items-center gap-1">
        <PanelToggle label="Charts" icon="chev" open={charts} onClick={onToggleCharts} />
        <PanelToggle label="Details" icon="list" open={state.panel !== null} onClick={() => session.showPanel(state.panel === null ? state.selected === null ? "objects" : "properties" : null)} />
      </div>
    </div>
  );
}
