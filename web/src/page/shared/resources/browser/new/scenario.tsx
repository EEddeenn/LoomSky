"use client";

import { createScenario } from "@/workbench/documents/scenario/actions";
import { scenarioCatalog } from "@/workbench/documents/scenario";
import { closePopover } from "@/page/shared/ui";

function nextName(): string {
  const names = new Set([...scenarioCatalog.get().entries.values()]
    .map((entry) => (entry.working?.summary ?? entry.head.summary).name));
  let number = 1;
  while (names.has(`Scenario ${number}`)) number++;
  return `Scenario ${number}`;
}

export function NewScenario({ busy, onBusyChange }: { busy: boolean; onBusyChange: (busy: boolean) => void }) {
  return <button type="button" role="menuitem" disabled={busy} className="px-3 py-2 text-left hover:bg-hover disabled:opacity-45" onClick={async (event) => {
    if (busy) return;
    closePopover(event.currentTarget);
    onBusyChange(true);
    try { await createScenario({ name: nextName() }); }
    finally { onBusyChange(false); }
  }}>Scenario</button>;
}
