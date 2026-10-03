"use client";

import { useLayoutEffect, useRef } from "react";
import { useStore } from "@/core";
import { cancelConfirmation, feedback } from "@/workbench/feedback";
import { page } from "@/workbench/navigation";
import { useFocusScope } from "@/page/shared/ui";
import { ConfirmationCard } from "./confirmation";
import { MessageCard } from "./cards/featured/message";
import { ProblemCard } from "./cards/featured/problem";

export function Cards() {
  const { problems, notice, confirmation } = useStore(feedback, (state) => state);
  const activityOpen = useStore(page, (state) => state.activity.open);
  const element = useRef<HTMLElement>(null);
  const urgent = problems.filter((problem) => problem.urgent);
  const initialFocus = () => element.current?.querySelector<HTMLButtonElement>(confirmation?.alternative === undefined
    ? '[data-confirmation] button:not(:disabled)' : '[data-confirmation-primary]:not(:disabled)') ?? null;
  useFocusScope(element, {
    kind: "confirmation", active: confirmation !== null,
    enabled: () => feedback.get().confirmation !== null && !page.get().activity.open,
    initialFocus,
    onEscape: () => { if (confirmation !== null) cancelConfirmation(confirmation.id, confirmation.version); },
  });
  useLayoutEffect(() => {
    if (confirmation !== null && !confirmation.pending && !activityOpen) initialFocus()?.focus({ preventScroll: true });
  }, [confirmation, activityOpen]);
  if (urgent.length === 0 && notice === null && confirmation === null) return null;
  const shell = "pointer-events-auto rounded-layer bg-face p-3 shadow-[var(--shadow),inset_0_0_0_1px_var(--line2)]";
  return <aside ref={element} tabIndex={-1} aria-label="Messages and confirmations" className="pointer-events-none absolute bottom-4 z-60 flex max-h-[calc(100%-80px)] w-[360px] max-w-[calc(100%-32px)] flex-col gap-2 overflow-y-auto overscroll-contain p-1 outline-none" style={{ right: activityOpen ? "min(452px, max(12px, 100% - 380px))" : 12 }}>
    {urgent.length === 0 ? null : <div className={shell}><ProblemCard problems={urgent} /></div>}
    {confirmation === null ? null : <div className={shell}><ConfirmationCard confirmation={confirmation} /></div>}
    {notice === null ? null : <div className={shell}><MessageCard card={notice} /></div>}
  </aside>;
}
