import type { PreviewFrame } from "@/model/preview";
import type { Track } from "@/model/trajectory";

type MarkerKind = "onair" | "armed" | "unknown" | "alarm" | "ended" | "cursor" | "ghost";
export type Marker = { key: string; kind: MarkerKind; t: number; label: string | null };
export type Scene = {
  track: Track | null;
  aired: [number, number][];
  markers: Marker[];
  cursor: number;
  following: boolean;
};

export function sceneOf(frame: PreviewFrame): Scene {
  const cursor = frame.epochMs / 1000;
  const markers = frame.lanes.flatMap<Marker>((lane) => lane.epochMs === null ? [] : [{
    key: lane.key,
    kind: lane.state === "off" ? "ended" : lane.state,
    t: lane.epochMs / 1000,
    label: lane.label,
  }]);
  const run = frame.owner.kind === "host" || frame.owner.kind === "submission";
  if (!run || !frame.following && !markers.some((marker) => Math.abs(marker.t - cursor) <= 0.5)) {
    markers.unshift({ key: "cursor", kind: run && markers.length > 0 ? "ghost" : "cursor", t: cursor, label: null });
  }
  return {
    track: frame.track,
    aired: frame.lanes.flatMap<[number, number]>((lane) => lane.sentMs === null || lane.sentMs <= lane.firstMs ? [] : [[lane.firstMs / 1000, lane.sentMs / 1000]]),
    markers,
    cursor,
    following: frame.following,
  };
}
