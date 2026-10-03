"use client";

import type { ReactNode } from "react";
import { useStore } from "@/core";
import { page, setRows } from "@/workbench/navigation";
import { Button } from "@/page/shared/ui";

export function EffectivePanel({ id, children }: { id: string; children: ReactNode }) {
  const open = useStore(page, (state) => state.rows[id] === true);
  return (
    <section className="flex min-w-0 flex-col gap-3 border-t border-line2 px-5 py-4">
      <Button
        size="sm"
        className="self-start"
        aria-expanded={open}
        onClick={() => setRows(id, !open)}
      >
        {open ? "Hide effective values" : "Effective values"}
      </Button>
      {open ? children : null}
    </section>
  );
}
