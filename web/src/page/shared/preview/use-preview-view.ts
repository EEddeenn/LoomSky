"use client";

import { useLayoutEffect, useMemo } from "react";
import { useStore } from "@/core";
import { previewOwnerKey, type PreviewBookmark } from "@/model/preview";
import { captureViewport, createViewMemory, page } from "@/workbench/navigation";
import type { PreviewSession } from "@/workbench/preview";

const bookmarks = createViewMemory<PreviewBookmark>();

export function usePreviewView(session: PreviewSession): void {
  const visitId = useStore(page, (state) => state.visitId);
  const instance = useStore(page, (state) => state.instance);
  const lease = useMemo(() => captureViewport(), [visitId, instance]);
  const key = previewOwnerKey(session.owner);

  useLayoutEffect(() => {
    const saved = bookmarks.read(lease, key);
    if (saved !== undefined) session.restore(saved);
    return bookmarks.register(lease, key, () => session.bookmark());
  }, [session, lease, key]);
}
