"use client";

import { age, mmss, offset } from "@/core";
import { gpsClock } from "@/model/gnss";
import { nameOf, type Host } from "@/workbench/hosts";
import type { Window } from "@/model/bundle";
import { Fig, Softkeys, TextInput } from "@/page/shared/ui";
import { Field } from "./field";
import { ProblemCue } from "./problem";

export function Start({ docId, window, mode, onModeChange, gpsNow, replayDraft, replayMs, onReplayDraftChange, others, othersLive }: {
  docId: string;
  window: Window;
  mode: "live" | "replay";
  onModeChange(mode: "live" | "replay"): void;
  gpsNow: number;
  replayDraft: string;
  replayMs: number | null;
  onReplayDraftChange(value: string): void;
  others: readonly Host[];
  othersLive: readonly Host[];
}) {
  const S = window.startGpsMs;
  const D = window.durationMs;
  const E = S + D;
  const ended = mode === "live" && gpsNow >= E;
  return (
    <Field label="Start">
      <Softkeys
        label="Start"
        options={[
          ["live", "Live"],
          ["replay", "Replay"],
        ]}
        value={mode}
        onChange={onModeChange}
        className="self-start"
      />
      {mode === "live" ? (
        ended ? (
          <ProblemCue id={`transmit:${docId}:window`} title="Live window ended" message={`Window ended ${age(gpsNow - E)} ago. Choose Replay.`} location="Start · Live" />
        ) : (
          <p className="m-0 leading-5 text-ink2">
            {gpsNow < S ? (
              <>
                Starts at{" "}
                <b className="font-semibold text-ink">
                  <Fig>{`${gpsClock(S)} GPS`}</Fig>
                </b>
                {" · in "}
                <b className="font-semibold text-ink">
                  <Fig>{mmss(S - gpsNow)}</Fig>
                </b>
                .
              </>
            ) : (
              <>
                Starts now at{" "}
                <b className="font-semibold text-ink">
                  <Fig>{offset(gpsNow - S)}</Fig>
                </b>{" "}
                · <Fig>{mmss(E - gpsNow)}</Fig> remaining.
              </>
            )}
          </p>
        )
      ) : (
        <div className="flex flex-col gap-1">
          <label htmlFor="transmit-replay" className="lab text-ink2">
            Replay offset
          </label>
          <TextInput
            id="transmit-replay"
            mono
            value={replayDraft}
            aria-invalid={replayMs === null}
            aria-describedby="transmit-replay-help"
            onChange={(e) => onReplayDraftChange(e.target.value)}
          />
          <span id="transmit-replay-help" className="text-small text-ink3">
            {replayMs === null ? (
              <ProblemCue id={`transmit:${docId}:replay`} title="Invalid replay offset" message={`Use +HH:MM:SS.mmm: 0 ≤ offset < ${offset(D, true)}.`} location="Start · Replay offset" />
            ) : (
              <Fig>{`${gpsClock(S + replayMs, true)} GPS`}</Fig>
            )}
          </span>
          {replayMs !== null && others.length > 0 ? <ProblemCue id={`transmit:${docId}:alignment`} level="warning" title="Replay is not synchronized" message={`Replay is not synchronized with ${others.map(nameOf).join(", ")}. Choose Live for GPS alignment.`} location="Start · Replay" /> : null}
        </div>
      )}
      {mode === "live" && othersLive.length > 0 ? (
        <span className="text-small text-ink3">
          Live aligns with {othersLive.map(nameOf).join(", ")} by GPS time.
        </span>
      ) : null}
    </Field>
  );
}
