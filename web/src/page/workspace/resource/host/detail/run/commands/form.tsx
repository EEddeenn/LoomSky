"use client";

import { useEffect, useRef } from "react";
import { nameOf, offWord } from "@/workbench/hosts";
import { sendCommand } from "@/workbench/hosts/actions";
import { commandFromDraft, type LevelUnit } from "@/model/host";
import { systems } from "@/model/gnss";
import { useStore } from "@/core";
import { page, setCommand } from "@/workbench/navigation";
import type { HostDisplay } from "../../../display";
import { Button, Icon, Softkeys, TextInput, Unit } from "@/page/shared/ui";

const levelUnits: readonly (readonly [LevelUnit, string])[] = [
  ["dbhz", "dB-Hz"],
  ["dbm", "dBm"],
  ["dbw", "dBW"],
  ["scenario", "Scenario level"],
];

export function CommandForm({ host, view }: HostDisplay) {
  const form = useStore(page, (s) => s.command);
  const { cls: c, status } = view;
  const can = (c === "onair" || c === "armed") && status !== null && status.state !== "ended";
  const command = commandFromDraft(form);
  const level = useRef<HTMLInputElement>(null);
  const handled = useRef(form.focus);
  useEffect(() => {
    if (form.focus === handled.current) return;
    handled.current = form.focus;
    level.current?.focus({ preventScroll: true });
    level.current?.select();
  }, [form.focus]);
  const select = "h-8 w-full appearance-none truncate rounded-key bg-face py-0 pr-[22px] pl-2 ring-field outline-none focus:shadow-[inset_0_0_0_2px_var(--ink)]";
  return (
    <div className="flex flex-col gap-2">
      <Softkeys
        label="Command"
        full
        options={[
          ["power", "Signal power"],
          ["noise", "Noise floor"],
          ["mask", "Elevation mask"],
        ]}
        value={form.kind}
        onChange={(kind) => setCommand({ kind })}
      />
      {form.kind === "power" ? (
        <div className="relative flex min-w-0 items-center gap-1.5">
          <span className="relative flex flex-[0_0_92px]">
            <select aria-label="System" value={form.system} onChange={(e) => setCommand({ system: systems.find((s) => s === e.target.value) ?? form.system })} className={select}>
              {systems.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <span className="pointer-events-none absolute top-2 right-1.5 text-ink2">
              <Icon name="chev" size={14} />
            </span>
          </span>
          <TextInput
            id="command-svid"
            mono
            className="flex-[0_0_48px]"
            inputMode="numeric"
            aria-label="Satellite, 0 for all"
            title="Satellite, 0 for all"
            value={form.svid}
            onChange={(e) => setCommand({ svid: e.target.value })}
          />
          <span aria-hidden="true" className="flex-none text-ink3">
            →
          </span>
          {form.unit === "scenario" ? null : (
            <TextInput ref={level} id="command-level" mono className="flex-[1_1_56px]" inputMode="decimal" aria-label="Level" value={form.value} onChange={(e) => setCommand({ value: e.target.value })} />
          )}
          <span className={`relative flex ${form.unit === "scenario" ? "flex-auto" : "flex-[0_0_76px]"}`}>
            <select aria-label="Unit" value={form.unit} onChange={(e) => setCommand({ unit: levelUnits.find(([u]) => u === e.target.value)?.[0] ?? form.unit })} className={select}>
              {levelUnits.map(([unit, words]) => (
                <option key={unit} value={unit}>
                  {words}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute top-2 right-1.5 text-ink2">
              <Icon name="chev" size={14} />
            </span>
          </span>
        </div>
      ) : form.kind === "noise" ? (
        <div className="w-40">
          <Unit input={<TextInput mono aria-label="Noise floor" inputMode="decimal" value={form.noise} onChange={(e) => setCommand({ noise: e.target.value })} />}>dBm/Hz</Unit>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <div className="w-40">
            <Unit input={<TextInput mono aria-label="Elevation mask" inputMode="decimal" value={form.mask} onChange={(e) => setCommand({ mask: e.target.value })} />}>°</Unit>
          </div>
          <span className="text-small text-ink3">Applies within 1 s</span>
        </div>
      )}
      {form.kind === "power" ? <p className="m-0 text-small text-ink3">0 = all satellites in this system.</p> : null}
      <Button
        size="sm" variant={can ? "primary" : "default"} icon="send" disabled={!can || command === null}
        aria-label={`Send to ${nameOf(host)}`}
        className="min-w-0 max-w-full self-start" onClick={() => { if (command !== null) sendCommand(host.key, command); }}
      >
        <span className="flex min-w-0 items-center gap-1">
          <span className="shrink-0">Send to</span>
          <span className="truncate">{nameOf(host)}</span>
        </span>
      </Button>
      {can ? null : (
        <p className="m-0 text-small text-ink3">{c === "unknown" ? `${nameOf(host)}: status unknown. Commands unavailable.` : `${nameOf(host)} is ${offWord(host).word.toLowerCase()}: commands need a run on air or armed.`}</p>
      )}
    </div>
  );
}
