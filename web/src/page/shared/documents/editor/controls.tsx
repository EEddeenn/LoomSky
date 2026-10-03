import type { ComponentProps } from "react";
import { fieldClass, focusRing, Icon } from "@/page/shared/ui";

export type Mark = "err" | "warn" | null;

export function inputClass(mark: Mark = null, mono = false): string {
  const edge = mark === "err" ? "shadow-[inset_0_0_0_2px_var(--fault)]" : mark === "warn" ? "shadow-[inset_0_0_0_2px_var(--warn)]" : focusRing;
  const focus = mark === null ? "" : "focus-visible:[outline:2px_solid_var(--focus)] focus-visible:outline-offset-2";
  return `${fieldClass} ${edge} ${focus} ${mono ? "fn" : ""}`;
}

export function Select({ className = "", children, flat = false, ...rest }: ComponentProps<"select"> & { flat?: boolean }) {
  return (
    <span className={`relative flex min-w-0 has-[select:disabled]:opacity-50 ${className}`}>
      <select className={`h-8 w-full appearance-none rounded-key py-0 pr-7 pl-2 text-ink outline-none disabled:cursor-not-allowed ${focusRing} ${flat ? "bg-panel text-small" : "bg-face"}`} {...rest}>
        {children}
      </select>
      <span className="pointer-events-none absolute top-2 right-2 text-ink2">
        <Icon name="chev" size={14} />
      </span>
    </span>
  );
}
