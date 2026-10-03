import { isRecord } from "@/core";
import { readSession, writeSession } from "@/io/storage";
import type { Camera, View } from "./camera";

export type Saved = Pick<View, "x" | "y" | "zoom">;

export type MapViewport = (camera: Pick<Camera, "view" | "onMove">, restore: (view: Saved) => void) => () => void;

export function readView(key: string): Saved | null {
  try {
    const v: unknown = JSON.parse(readSession(`view:${key}`) ?? "null");
    return isRecord(v) &&
      typeof v.x === "number" && Number.isFinite(v.x) &&
      typeof v.y === "number" && Number.isFinite(v.y) &&
      typeof v.zoom === "number" && Number.isFinite(v.zoom)
      ? { x: v.x, y: v.y, zoom: v.zoom }
      : null;
  } catch {
    return null;
  }
}

export function writeView(key: string, v: Saved): void {
  writeSession(`view:${key}`, JSON.stringify({ x: v.x, y: v.y, zoom: v.zoom }));
}
