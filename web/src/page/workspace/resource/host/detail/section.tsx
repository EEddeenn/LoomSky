"use client";

import type { ReactNode } from "react";

export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 border-b border-line px-5 py-4">
      <h2 className="lab m-0">{title}</h2>
      {children}
    </section>
  );
}

export function Pairs({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-5 gap-y-2 leading-5">
      {rows.filter(([, value]) => value !== null).map(([label, value]) => (
        <div className="contents" key={label}>
          <dt className="lab text-ink3">{label}</dt>
          <dd className="m-0 min-w-0 [overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
