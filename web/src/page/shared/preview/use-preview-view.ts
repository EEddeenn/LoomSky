"use client";

import { useCallback, useLayoutEffect, useMemo } from "react";
import { useStore } from "@/core";
import { previewOwnerKey, type PreviewBookmark } from "@/model/preview";
import { canRestoreViewport, captureViewport, createViewMemory, page } from "@/workbench/navigation";
import type { PreviewSession } from "@/workbench/preview";
import { readView, writeView, type MapViewport, type Saved } from "./map";

const bookmarks = createViewMemory<PreviewBookmark>();
const cameras = createViewMemory<Saved>();

export function usePreviewView(session: PreviewSession): MapViewport {
  const visitId = useStore(page, (state) => state.visitId);
  const instance = useStore(page, (state) => state.instance);
  const lease = useMemo(() => captureViewport(), [visitId, instance]);
  const key = previewOwnerKey(session.owner);

  useLayoutEffect(() => {
    const saved = bookmarks.read(lease, key);
    if (saved !== undefined) session.restore(saved);
    return bookmarks.register(lease, key, () => session.bookmark());
  }, [session, lease, key]);

  return useCallback((camera, restore) => {
    const saved = cameras.read(lease, key) ?? readView(key);
    if (saved !== null && canRestoreViewport(lease)) restore(saved);
    const position = (): Saved => {
      const { x, y, zoom } = camera.view();
      return { x, y, zoom };
    };
    const unregister = cameras.register(lease, key, position);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = camera.onMove(() => {
      clearTimeout(timer);
      timer = setTimeout(() => writeView(key, position()), 500);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
      unregister();
      writeView(key, position());
    };
  }, [lease, key]);
}
