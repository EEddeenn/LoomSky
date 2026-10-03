"use client";

import type { ReactNode } from "react";

export function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      {htmlFor === undefined ? <span className="lab text-ink2">{label}</span> : <label htmlFor={htmlFor} className="lab text-ink2">{label}</label>}
      {children}
    </div>
  );
}
