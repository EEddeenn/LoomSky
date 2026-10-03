"use client";

import { cancelConfirmation, confirmConfirmation, type ConfirmationRecord } from "@/workbench/feedback";
import { Button, FeedbackIcon, Fig } from "@/page/shared/ui";

export function ConfirmationCard({ confirmation }: { confirmation: ConfirmationRecord }) {
  return <section data-confirmation tabIndex={-1} role="group" aria-label={confirmation.title} className="flex flex-col gap-3 outline-none">
    <div className="flex items-start gap-2">
      <FeedbackIcon level="warning" />
      <div className="min-w-0 flex-1">
        <div className="text-small text-ink3">{confirmation.scope}</div>
        <h3 className="m-0 text-small font-semibold">{confirmation.title}</h3>
      </div>
    </div>
    <p className="m-0 text-small leading-5 text-ink2 [overflow-wrap:anywhere]">{confirmation.message}</p>
    {confirmation.details === undefined ? null : (
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-key bg-panel px-3 py-2 text-small">
        {confirmation.details.map((detail) => (
          <div key={detail.label} className="contents">
            <dt className="text-ink3">{detail.label}</dt>
            <dd className="m-0 text-right [overflow-wrap:anywhere]"><Fig>{detail.value}</Fig></dd>
          </div>
        ))}
      </dl>
    )}
    <div className="flex justify-end gap-2">
      {confirmation.alternative === undefined
        ? <Button size="sm" disabled={confirmation.pending} onClick={() => cancelConfirmation(confirmation.id, confirmation.version)}>Cancel</Button>
        : <Button size="sm" disabled={confirmation.pending} onClick={() => void confirmConfirmation(confirmation.id, confirmation.version, true)}>{confirmation.alternative.label}</Button>}
      <Button data-confirmation-primary size="sm" variant="primary" disabled={confirmation.pending} onClick={() => void confirmConfirmation(confirmation.id, confirmation.version)}>{confirmation.pending ? "Working…" : confirmation.confirmLabel}</Button>
    </div>
    <span role="status" className="vh">{confirmation.pending ? `${confirmation.confirmLabel} in progress` : `Confirmation required: ${confirmation.title}`}</span>
  </section>;
}
