"use client";

import { useState } from "react";
import { createScenario } from "@/workbench/documents/scenario/actions";
import { scenarioCatalog } from "@/workbench/documents/scenario";
import { Button, closePopover, focusRing, Popover, PopoverBody, PopoverFooter, PopoverHead, TextInput } from "@/page/shared/ui";

function nextName(): string {
  const names = new Set([...scenarioCatalog.get().entries.values()].filter((entry) => entry.head.archivedAt === null)
    .map((entry) => (entry.working?.summary ?? entry.head.summary).name));
  let number = 1;
  while (names.has(`Scenario ${number}`)) number++;
  return `Scenario ${number}`;
}

export function NewScenario({ busy, onBusyChange, anchor }: { busy: boolean; onBusyChange: (busy: boolean) => void; anchor: string }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  return (
    <Popover id="new-scenario-popover" anchor={anchor} label="New scenario" onOpen={() => setName((value) => value || nextName())}>
      <PopoverHead title="New scenario" />
      <form
        className="flex min-h-0 flex-col"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || name.trim() === "") return;
          const form = event.currentTarget;
          onBusyChange(true);
          try {
            if (!await createScenario({ name: name.trim(), description: description.trim() })) return;
            setName("");
            setDescription("");
            closePopover(form);
          } finally {
            onBusyChange(false);
          }
        }}
      >
        <PopoverBody>
          <div className="flex flex-col gap-1">
            <label htmlFor="scenario-name" className="lab text-ink2">Name</label>
            <TextInput id="scenario-name" data-autofocus required disabled={busy} value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="scenario-description" className="flex items-baseline gap-2">
              <span className="lab text-ink2">Description</span>
              <span className="text-small text-ink3">optional</span>
            </label>
            <textarea
              id="scenario-description"
              rows={3}
              disabled={busy}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className={`w-full min-w-0 resize-y rounded-key bg-face px-2 py-1.5 text-ink outline-none disabled:opacity-50 ${focusRing}`}
            />
          </div>
        </PopoverBody>
        <PopoverFooter>
          <Button size="sm" variant="ghost" disabled={busy} onClick={(event) => { setName(""); setDescription(""); closePopover(event.currentTarget); }}>Cancel</Button>
          <span className="flex-1" />
          <Button size="sm" type="submit" variant="primary" disabled={busy || name.trim() === ""}>{busy ? "Creating…" : "Create"}</Button>
        </PopoverFooter>
      </form>
    </Popover>
  );
}
