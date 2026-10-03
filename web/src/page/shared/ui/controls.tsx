import type { ComponentProps, ReactNode } from "react";
import { Icon, type IconName } from "./icons";

type Variant = "default" | "primary" | "danger" | "ghost";
type Size = "md" | "sm" | "xs";

const variants: Record<Variant, string> = {
  default: "bg-face text-ink ring-key enabled:hover:bg-hover",
  primary: "bg-primary text-on-primary [box-shadow:var(--primary-ring)] enabled:hover:bg-primary-hover",
  danger: "bg-rf text-on-rf font-semibold enabled:hover:bg-rf-deep",
  ghost: "bg-transparent text-ink2 enabled:hover:bg-hover enabled:hover:text-ink",
};
const sizes: Record<Size, string> = {
  md: "h-8 px-3 gap-2",
  sm: "h-7 px-2.5 gap-2",
  xs: "h-6 px-2 gap-1 text-small",
};
const iconSizes: Record<Size, string> = { md: "w-8", sm: "w-7", xs: "w-6" };
const glyphSizes: Record<Size, number> = { md: 16, sm: 14, xs: 12 };

export function Button({
  variant = "default",
  size = "md",
  icon,
  iconOnly = false,
  className = "",
  children,
  type = "button",
  ...rest
}: ComponentProps<"button"> & { variant?: Variant; size?: Size; icon?: IconName; iconOnly?: boolean }) {
  return (
    <button
      type={type}
      className={`inline-flex shrink-0 items-center justify-center rounded-key font-medium whitespace-nowrap disabled:opacity-45 ${variants[variant]} ${sizes[size]} ${iconOnly ? `${iconSizes[size]} px-0` : ""} ${className}`}
      {...rest}
    >
      {icon !== undefined ? <Icon name={icon} size={glyphSizes[size]} /> : null}
      {children}
    </button>
  );
}

export function Softkeys<T extends string>({
  label,
  options,
  value,
  onChange,
  full = false,
  className = "",
}: {
  label: string;
  options: readonly (readonly [T, string])[];
  value: T | null;
  onChange(value: T): void;
  full?: boolean;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={`${full ? "flex" : "inline-flex"} rounded-key bg-face ring-key ${className}`}>
      {options.map(([key, text], i) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={`h-7 px-3 font-medium whitespace-nowrap ${full ? "flex-1" : ""} ${i === 0 ? "rounded-l-key" : ""} ${i === options.length - 1 ? "rounded-r-key" : ""} ${i > 0 ? "shadow-[inset_1px_0_0_var(--line2)]" : ""} ${value === key ? "bg-sel text-on-sel shadow-none" : "text-ink2 hover:bg-hover hover:text-ink"}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export const fieldClass = "h-8 w-full min-w-0 rounded-key bg-face px-2 text-ink outline-none disabled:opacity-50";
export const focusRing = "ring-field focus:shadow-[inset_0_0_0_2px_var(--ink)]";

export function TextInput({ mono = false, className = "", ...rest }: ComponentProps<"input"> & { mono?: boolean }) {
  return <input className={`${fieldClass} ${focusRing} ${mono ? "fn" : ""} ${className}`} spellCheck={false} autoComplete="off" {...rest} />;
}

export function Toggle({ checked, onChange, children, title, disabled }: { checked: boolean; disabled?: boolean; onChange(checked: boolean): void; children: ReactNode; title?: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-ink2 has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-50" title={title}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="relative m-0 h-4 w-7 flex-none cursor-pointer appearance-none rounded-key bg-face ring-field after:absolute after:top-[3px] after:left-[3px] after:h-2.5 after:w-2.5 after:rounded-[1px] after:bg-ink3 after:content-[''] checked:bg-ink checked:shadow-none checked:after:translate-x-3 checked:after:bg-display disabled:cursor-not-allowed"
      />
      {children}
    </label>
  );
}

export function Unit({ children, input }: { children: ReactNode; input: ReactNode }) {
  return (
    <div className="flex min-w-0 [&>input]:rounded-r-none">
      {input}
      <span className="-ml-px flex items-center rounded-r-key bg-panel px-2 text-small whitespace-nowrap text-ink2 ring-field">{children}</span>
    </div>
  );
}
