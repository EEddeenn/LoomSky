"use client";

import type { PreviewFrame } from "@/model/preview";
import { MapView, type MapEditing } from "@/page/shared/preview/map";
import { sceneOf, type PreviewSession } from "@/workbench/preview";

export function PreviewMap({ frame, session, editing }: {
  frame: PreviewFrame;
  session?: PreviewSession;
  editing?: MapEditing;
}) {
  const scene = sceneOf(frame);
  const label = scene.track === null
    ? "Map of the lab area"
    : `Map: ${frame.scope}, the planned track${scene.aired.length > 0 ? " with the aired stretch drawn bold" : ""}; its readout gives the position at the cursor`;
  return <MapView
    viewKey={frame.ownerKey}
    scene={scene}
    label={label}
    editing={editing}
    follow={session !== undefined && frame.capabilities.follow && scene.track !== null
      ? { name: frame.lanes[0]?.label ?? frame.scope, active: frame.following, change: (enabled) => session.follow(enabled) }
      : undefined}
  />;
}
