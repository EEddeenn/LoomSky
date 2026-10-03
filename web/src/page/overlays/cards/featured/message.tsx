"use client";

import { dismissNotification, type Notice } from "@/workbench/feedback";
import { Button, FeedbackIcon, Fig } from "@/page/shared/ui";

export function MessageCard({ card }: { card: Notice }) {
  return <div role="status" className="flex items-start gap-2">
    <FeedbackIcon level={card.level} />
    <p className="m-0 min-w-0 flex-1 text-small leading-5 [overflow-wrap:anywhere]"><Fig>{card.message}</Fig></p>
    <Button variant="ghost" size="xs" iconOnly icon="x" aria-label="Dismiss message" onClick={() => dismissNotification(card.id)} />
  </div>;
}
