"use client";

import { useRef } from "react";
import { mmss, useStore } from "@/core";
import { packedLeap } from "@/model/bundle";
import { gpsClock, utcClock } from "@/model/gnss";
import { hosts, nameOf } from "@/workbench/hosts";
import { page } from "@/workbench/navigation";
import { feedback } from "@/workbench/feedback";
import { useNow } from "@/workbench/clock";
import { chooseTransmissionHost, chooseTransmissionScenario, closeTransmission, configurationOf, reviewTransmission, sendTransmission, updateTransmission, setTransmissionGain, setTransmissionMode, setTransmissionReplay, type TransmissionSession } from "@/workbench/transmit";
import { Button, Fig, Icon, TextInput, Unit, useFocusScope } from "@/page/shared/ui";
import { Field } from "./configuration/field";
import { ProblemCue } from "./configuration/problem";
import { Start } from "./configuration/start";

export function Configuration({ session }: { session: TransmissionSession }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useFocusScope(dialog, {
    kind: "dialog", enabled: () => !page.get().activity.open,
    initialFocus: () => dialog.current?.querySelector<HTMLButtonElement>('[aria-label="Close"]') ?? null,
    onEscape: closeTransmission,
  });
  const now = useNow();
  const activityOpen = useStore(page, (state) => state.activity.open);
  const confirmationOpen = useStore(feedback, (state) => state.confirmation !== null);
  useStore(hosts, (state) => state);
  const { source } = session;
  const { host, choices, gpsNow, replayMs, startMs, gainIssue, others, othersLive, config } = configurationOf(session, now);
  const leap = packedLeap(source.window);
  const end = source.window.startGpsMs + source.window.durationMs;
  return (
    <>
      <div className="absolute right-0 bottom-0 left-0 z-50 bg-scrim" style={{ top: 48 }} onClick={closeTransmission} aria-hidden="true" />
      <dialog
        ref={dialog}
        open
        tabIndex={-1}
        aria-modal={!activityOpen && !confirmationOpen}
        aria-labelledby="transmit-title"
        onCancel={(event) => { event.preventDefault(); closeTransmission(); }}
        className="absolute top-[calc(50%+24px)] left-1/2 z-51 m-0 flex max-h-[calc(100%-96px)] w-[min(580px,calc(100%-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-layer border-0 bg-panel p-0 text-ink outline-none shadow-[var(--shadow),inset_0_0_0_1px_var(--line2)]"
      >
        <header className="flex items-center gap-2 px-5 pt-4 pb-2">
          <Icon name="send" size={20} />
          <h3 id="transmit-title" className="m-0 text-title font-semibold">
            {session.review !== null ? `Transmit on ${nameOf(session.review.host)}?` : host === undefined ? "Transmission" : `Transmission · ${nameOf(host)}`}
          </h3>
          <span className="flex-auto" />
          <Button variant="ghost" size="sm" iconOnly icon="x" aria-label="Close" onClick={closeTransmission} />
        </header>
        {session.review !== null ? <div className="overflow-auto px-5 pt-1 pb-4">
          <p className="text-small">Starts RF transmission. Closing this page does not stop {nameOf(session.review.host)}.</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-small">
            {session.review.details.map(({ label, value }) => <div className="contents" key={label}><dt className="text-muted">{label}</dt><dd className="m-0 break-all">{value}</dd></div>)}
          </dl>
        </div> : <div className="flex flex-col gap-4 overflow-auto px-5 pt-1 pb-4">
          <Field label="Radio host">
            <div role="radiogroup" aria-label="Radio host" className="flex flex-col border-y border-line2">
              {choices.map(({ host: x, issue: reason }, i) => {
                const checked = session.host === x.key;
                return (
                  <button
                    key={x.key}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    disabled={reason !== ""}
                    onClick={() => chooseTransmissionHost(session, x.key)}
                    className={`grid min-h-9 w-full grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-2 px-2 py-1.5 text-left ${i > 0 ? "border-t border-line" : ""} ${checked ? "bg-face shadow-[inset_3px_0_0_var(--ink)]" : "enabled:hover:bg-hover"} disabled:cursor-not-allowed`}
                  >
                    <span className={`grid size-4 place-items-center rounded-full bg-face ${checked ? "shadow-[inset_0_0_0_5px_var(--ink)]" : "shadow-[inset_0_0_0_1.5px_var(--field)]"}`} />
                    <span className={`font-semibold ${reason !== "" ? "opacity-60" : ""}`}>{nameOf(x)}</span>
                    {reason !== "" ? (
                      <span className="text-small whitespace-nowrap text-ink2">
                        <Fig>{reason}</Fig>
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="Scenario version">
            <div className="flex min-h-8 items-center gap-2 rounded-key px-2.5 py-1.5 ring-key">
              <b className="min-w-0 flex-1 truncate font-semibold">{source.resourceId} · v{source.versionNumber}</b>
              <Button size="xs" variant="ghost" onClick={() => chooseTransmissionScenario(session)}>Change…</Button>
            </div>
            <span className="text-small text-ink3">
              <Fig>{`${gpsClock(source.window.startGpsMs)} → ${gpsClock(end)} GPS · ${utcClock(source.window.startGpsMs, leap)} → ${utcClock(end, leap)} UTC`}</Fig>
            </span>
            <span className="text-small text-ink3">Uses the saved version, not editor changes.</span>
          </Field>
          <Start
            docId={source.resourceId} window={source.window} mode={session.mode} onModeChange={(mode) => setTransmissionMode(session, mode)}
            gpsNow={gpsNow} replayDraft={session.replayDraft} replayMs={replayMs} onReplayDraftChange={(draft) => setTransmissionReplay(session, draft)}
            others={others} othersLive={othersLive}
          />
          <Field label="Gain" htmlFor="transmit-gain">
            <div className="flex items-center gap-2.5">
              <div className="w-[140px]">
                <Unit input={<TextInput id="transmit-gain" mono inputMode="decimal" value={session.gain} aria-invalid={gainIssue} aria-describedby={gainIssue ? "transmit-gain-help" : undefined} onChange={(e) => setTransmissionGain(session, e.target.value)} />}>dB</Unit>
              </div>
              {host?.snapshot != null ? (
                <span className="text-small text-ink3">
                  <Fig>{`max ${host.snapshot.station.max_gain_db} dB`}</Fig>
                </span>
              ) : null}
            </div>
            {gainIssue ? <span id="transmit-gain-help"><ProblemCue id={`transmit:${source.resourceId}:gain`} title="Invalid gain" message={host?.snapshot == null ? "Enter a valid gain in dB." : `Enter a valid gain ≤ ${host.snapshot.station.max_gain_db} dB.`} location="Gain" /></span> : null}
          </Field>
          {startMs !== null && host !== undefined ? (
            <div className="border-l-3 border-rf-mark bg-face px-3 py-2 leading-5">
              <b className="font-semibold">{nameOf(host)}</b> · <b className="font-semibold">{source.resourceId}</b> · {" "}
              {session.mode === "live" ? (
                <>
                  until{" "}
                  <b className="font-semibold" title={`${utcClock(end, leap)} UTC`}>
                    <Fig>{`${gpsClock(end)} GPS`}</Fig>
                  </b> or Stop.
                </>
              ) : (
                <>
                  <b className="font-semibold">
                    <Fig>{mmss(source.window.durationMs - startMs)}</Fig>
                  </b>{" "}
                  on its own clock or until Stop.
                </>
              )}
            </div>
          ) : null}
        </div>}
        {session.reviewError === null ? null : <p role="alert" className="m-0 border-t border-line2 px-5 py-3 text-small text-fault">{session.reviewError}</p>}
        <footer className="flex justify-end gap-2 border-t border-line2 bg-panel px-5 py-3">
          <Button onClick={closeTransmission}>
            Cancel
          </Button>
          {session.review === null ? <Button variant="danger" icon="send" disabled={config.kind !== "ready"} onClick={() => reviewTransmission(session)}>
            Review
          </Button> : <>
            <Button disabled={session.sending} onClick={() => updateTransmission(session, { review: null })}>Back</Button>
            <Button variant="danger" icon="send" disabled={session.sending} onClick={() => { void sendTransmission(session); }}>
              {session.sending ? "Sending…" : `Transmit on ${nameOf(session.review.host)}`}
            </Button>
          </>}
        </footer>
      </dialog>
    </>
  );
}
