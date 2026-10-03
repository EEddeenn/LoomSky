"use client";

import { useState } from "react";
import { forgetToken, setToken } from "@/workbench/hosts/connection";
import type { Host } from "@/workbench/hosts";
import { removeHost, retry } from "@/workbench/hosts/actions";
import { Button, TextInput } from "@/page/shared/ui";
import { DetailSection } from "../section";

export function Settings({ host }: { host: Host }) {
  const [token, setText] = useState("");
  const [status, setStatus] = useState<"editing" | "saving" | "saved">("editing");
  const saving = status === "saving";
  return (
    <>
      <DetailSection title="Connection settings">
        <form
          className="flex max-w-xl flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (token.trim() === "" || saving) return;
            setStatus("saving");
            void setToken(host.key, token.trim()).then((ok) => {
              setStatus(ok ? "saved" : "editing");
              if (ok) {
                setText("");
                retry(host.key);
              }
            }).catch(() => setStatus("editing"));
          }}
        >
          <label htmlFor="device-token" className="lab text-ink2">Token</label>
          <p className="m-0 text-small text-ink3">From host config. Saved in this browser.</p>
          <div className="flex gap-2">
            <TextInput
              id="device-token"
              type="password"
              disabled={saving}
              value={token}
              onChange={(event) => {
                setText(event.target.value);
                setStatus("editing");
              }}
            />
            <Button type="submit" disabled={saving || token.trim() === ""}>{saving ? "Saving…" : "Save token"}</Button>
            <Button
              disabled={saving || host.record.token === ""}
              onClick={() => {
                setStatus("editing");
                void forgetToken(host.key);
              }}
            >
              Forget token
            </Button>
          </div>
          {status === "saved" ? <p role="status" className="m-0 text-small text-ink2">Saved. Checking connection…</p> : null}
        </form>
      </DetailSection>
      <DetailSection title="Remove transmitter">
        <Button
          size="sm"
          icon="trash"
          className="self-start"
          onClick={() => void removeHost(host.key)}
        >
          Remove transmitter
        </Button>
      </DetailSection>
    </>
  );
}
