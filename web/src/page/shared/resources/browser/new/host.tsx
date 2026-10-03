"use client";

import { useEffect, useRef, useState } from "react";
import { addHost, checkHost, type HostCheck } from "@/workbench/hosts/connection";
import { bands } from "@/model/gnss";
import { openResource } from "@/workbench/navigation";
import { Button, closePopover, Fig, Icon, Popover, PopoverBody, PopoverFooter, PopoverHead, TextInput } from "@/page/shared/ui";

type Check = { kind: "idle" } | { kind: "pending" } | { kind: "answered"; value: HostCheck };

export function AddHost({ anchor }: { anchor: string }) {
  const [address, setAddress] = useState("");
  const [token, setToken] = useState("");
  const [state, setState] = useState<Check>({ kind: "idle" });
  const [saving, setSaving] = useState(false);
  const busy = saving || state.kind === "pending";
  const attempt = useRef(0);
  useEffect(() => () => { attempt.current++; }, []);

  const invalidate = () => {
    attempt.current++;
    setSaving(false);
    setState({ kind: "idle" });
  };
  const check = async () => {
    if (busy || address.trim() === "") return;
    const id = ++attempt.current;
    setState({ kind: "pending" });
    const result = await checkHost(address, token, location.origin);
    if (id === attempt.current) setState({ kind: "answered", value: result });
  };

  const result = state.kind === "answered" ? state.value : null;
  const checked = result?.kind === "ready" ? result.host : null;
  const station = checked?.snapshot.station ?? null;
  return (
    <Popover
      id="add-host-popover"
      anchor={anchor}
      width={360}
      label="Add transmitter"
      onClose={() => {
        attempt.current++;
        setSaving(false);
        if (state.kind === "pending") setState({ kind: "idle" });
      }}
    >
      <PopoverHead title="Add transmitter" />
      <form
        className="flex min-h-0 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          void check();
        }}
      >
        <PopoverBody>
          <div className="flex flex-col gap-1">
            <label htmlFor="host-address" className="lab text-ink2">
              Address
            </label>
            <TextInput id="host-address" data-autofocus mono disabled={busy} value={address} placeholder="127.0.0.1:8740" onChange={(e) => (invalidate(), setAddress(e.target.value))} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="host-token" className="flex items-baseline gap-2">
              <span className="lab text-ink2">Token</span>
              <span className="text-small text-ink3">From host file; saved in this browser</span>
            </label>
            <TextInput id="host-token" type="password" disabled={busy} value={token} onChange={(e) => (invalidate(), setToken(e.target.value))} />
          </div>
          {station !== null ? (
            <div className="flex items-start gap-2 border-l-2 border-ink py-1 pl-3 leading-5">
              <span className="mt-0.5 text-ink">
                <Icon name="done" />
              </span>
              <Fig>{`${station.name} · ${bands(station.bands_hz)} · max ${station.max_gain_db} dB`}</Fig>
            </div>
          ) : null}
          {result?.kind === "failed" ? <p role="alert" className="m-0 text-small text-fault">{result.message}</p> : null}
        </PopoverBody>
        <PopoverFooter>
          <Button size="sm" variant="ghost" onClick={(e) => {
            invalidate();
            setAddress("");
            setToken("");
            closePopover(e.currentTarget);
          }}>
            Cancel
          </Button>
          <span className="flex-1" />
          <Button size="sm" type="submit" disabled={busy || address.trim() === ""}>
            {state.kind === "pending" ? "Checking…" : "Check"}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={checked === null || busy}
            onClick={async (e) => {
              if (busy || checked === null) return;
              const id = ++attempt.current;
              const target = e.currentTarget;
              setSaving(true);
              const added = await addHost(checked.address, checked.token, checked.snapshot);
              if (id !== attempt.current) return;
              setSaving(false);
              if (!added) return;
              openResource({ kind: "host", key: checked.address });
              setState({ kind: "idle" });
              setAddress("");
              setToken("");
              closePopover(target);
            }}
          >
            {saving ? "Adding…" : "Add"}
          </Button>
        </PopoverFooter>
      </form>
    </Popover>
  );
}
