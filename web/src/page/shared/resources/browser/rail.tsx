"use client";

import type { LibraryKind } from "@/workbench/library";

const sections: readonly (readonly ["all" | LibraryKind, string])[] = [
  ["all", "All"],
  ["scenario", "Scenarios"],
  ["trajectory", "Trajectories"],
  ["file", "Data files"],
  ["host", "Transmitters"],
];

export function LibraryRail({ filter, onFilterChange, counts }: {
  filter: "all" | LibraryKind;
  onFilterChange: (filter: "all" | LibraryKind) => void;
  counts: Record<LibraryKind, number>;
}) {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return (
    <nav aria-label="Library resource types" className="w-40 min-w-0 flex-none overflow-auto border-r border-line bg-panel py-1">
      {sections.map(([kind, title]) => (
        <button
          key={kind}
          type="button"
          aria-current={filter === kind}
          onClick={() => onFilterChange(kind)}
          className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2 py-2 pr-3 pl-4 text-left text-ink ${filter === kind ? "bg-face shadow-[inset_3px_0_0_var(--ink),inset_0_1px_0_var(--line),inset_0_-1px_0_var(--line)]" : "hover:bg-hover"}`}
        >
          <span className="lab">{title}</span>
          <span className="fn text-small text-ink3">{kind === "all" ? total : counts[kind]}</span>
        </button>
      ))}
    </nav>
  );
}
