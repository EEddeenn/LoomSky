"use client";

import type { ComponentProps } from "react";
import type { ResourceRef } from "@/model/resource";
import { navigate, resourceDestination, routePath, type Destination } from "@/workbench/navigation";
import { Icon, type IconName } from "./ui";

export { bindViewport, useViewport } from "./navigation/restore";

type Variant = "plain" | "default" | "ghost";
type Size = "md" | "sm" | "xs";

const variants: Record<Exclude<Variant, "plain">, string> = {
  default: "bg-face text-ink ring-key hover:bg-hover",
  ghost: "bg-transparent text-ink2 hover:bg-hover hover:text-ink",
};
const sizes: Record<Size, string> = {
  md: "h-8 px-3 gap-2",
  sm: "h-7 px-2.5 gap-2",
  xs: "h-6 px-2 gap-1 text-small",
};
const glyphSizes: Record<Size, number> = { md: 16, sm: 14, xs: 12 };

type NavLinkProps = Omit<ComponentProps<"a">, "href" | "resource"> & {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
} & (
  | { destination: Destination; resource?: never }
  | { destination?: never; resource: ResourceRef }
);

export function NavLink({ destination, resource, variant = "plain", size = "md", icon, className = "", children, onClick, ...rest }: NavLinkProps) {
  const route = destination ?? resourceDestination(resource);
  const appearance = variant === "plain" ? "" : `inline-flex shrink-0 items-center justify-center rounded-key font-medium whitespace-nowrap ${variants[variant]} ${sizes[size]}`;
  return <a
    {...rest}
    href={routePath(route)}
    className={`${appearance} ${className}`.trim()}
    onClick={(event) => {
      onClick?.(event);
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey
        || event.currentTarget.target !== "" && event.currentTarget.target !== "_self" || event.currentTarget.hasAttribute("download")) return;
      event.preventDefault();
      navigate(route);
    }}
  >
    {icon === undefined ? null : <Icon name={icon} size={glyphSizes[size]} />}
    {children}
  </a>;
}
