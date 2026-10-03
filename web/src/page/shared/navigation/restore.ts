"use client";

import { useLayoutEffect, useMemo, type RefObject } from "react";
import { useStore } from "@/core";
import { canRestoreViewport, captureViewport, page, readViewport, registerViewport, saveViewport, type Viewport, type ViewportLease } from "@/workbench/navigation";

export function bindViewport(element: HTMLElement, key: string, lease: ViewportLease): () => void {
  const target = readViewport(lease, key) ?? { top: 0, left: 0 };
  let restoring = canRestoreViewport(lease);
  let active = true;
  let frame: number | null = null;
  let resize: ResizeObserver | null = null;
  let mutation: MutationObserver | null = null;
  const position = (): Viewport => ({ top: element.scrollTop, left: element.scrollLeft });
  const unregister = registerViewport(lease, key, () => restoring && canRestoreViewport(lease) ? target : position());

  const stopRestoring = () => {
    restoring = false;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    resize?.disconnect();
    mutation?.disconnect();
  };
  const save = () => {
    if (restoring && !canRestoreViewport(lease)) stopRestoring();
    if (!restoring) saveViewport(lease, key, position());
  };
  const restore = () => {
    frame = null;
    if (!restoring) return;
    if (!canRestoreViewport(lease)) { stopRestoring(); return; }
    element.scrollTop = target.top;
    element.scrollLeft = target.left;
    if (Math.abs(element.scrollTop - target.top) < 1 && Math.abs(element.scrollLeft - target.left) < 1) {
      stopRestoring();
      save();
    }
  };
  const schedule = () => {
    if (restoring && frame === null) frame = requestAnimationFrame(restore);
  };
  const observe = () => {
    resize?.observe(element);
    for (const child of element.children) resize?.observe(child);
    schedule();
  };
  const interrupt = () => { stopRestoring(); save(); };

  element.addEventListener("scroll", save, { passive: true });
  element.addEventListener("wheel", interrupt, { passive: true });
  element.addEventListener("pointerdown", interrupt);
  element.addEventListener("keydown", interrupt);
  if (restoring) restore();
  if (restoring) {
    resize = new ResizeObserver(schedule);
    mutation = new MutationObserver(observe);
    mutation.observe(element, { childList: true, characterData: true, subtree: true });
    observe();
  }

  return () => {
    if (!active) return;
    active = false;
    unregister();
    stopRestoring();
    element.removeEventListener("scroll", save);
    element.removeEventListener("wheel", interrupt);
    element.removeEventListener("pointerdown", interrupt);
    element.removeEventListener("keydown", interrupt);
  };
}

export function useViewport(ref: RefObject<HTMLElement | null>, key: string, ready = true): void {
  const visitId = useStore(page, (state) => state.visitId);
  const lease = useMemo(() => captureViewport(), [visitId]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || !ready || page.get().visitId !== visitId) return;
    return bindViewport(element, key, lease);
  }, [ref, key, ready, visitId, lease]);
}
