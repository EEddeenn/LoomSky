"use client";

import { useEffect, useRef, type ReactNode, type ToggleEvent } from "react";

type Place = "below" | "left";

function placeAt(popover: HTMLElement, anchor: string, place: Place, width: number): void {
  const a = document.getElementById(anchor)?.getBoundingClientRect();
  if (a === undefined) return;
  const margin = 8;
  const fittedWidth = Math.min(width, innerWidth - margin * 2);
  popover.style.width = `${fittedWidth}px`;
  popover.style.maxHeight = `${innerHeight - margin * 2}px`;
  const height = popover.getBoundingClientRect().height;
  const left = place === "left" ? a.left - fittedWidth - margin : a.left;
  const below = a.bottom + 6;
  const above = a.top - height - 6;
  const top = place === "left" ? a.top : below + height > innerHeight - margin && above >= margin ? above : below;
  popover.style.left = `${Math.max(margin, Math.min(left, innerWidth - fittedWidth - margin))}px`;
  popover.style.top = `${Math.max(margin, Math.min(top, innerHeight - height - margin))}px`;
}

export function closePopover(inside: Element): void {
  const popover = inside.closest<HTMLElement>("[popover]");
  if (popover?.matches(":popover-open")) popover.hidePopover();
}

export function Popover({
  id,
  anchor,
  place = "below",
  width = 360,
  label,
  role = "dialog",
  className = "",
  onOpen,
  onClose,
  children,
}: {
  id: string;
  anchor: string;
  place?: Place;
  width?: number;
  label: string;
  role?: "dialog" | "menu";
  className?: string;
  onOpen?: () => void;
  onClose?: () => void;
  children: ReactNode;
}) {
  const element = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const popover = element.current;
    if (popover === null) return;
    const position = () => {
      if (popover.matches(":popover-open")) placeAt(popover, anchor, place, width);
    };
    const observer = new ResizeObserver(position);
    observer.observe(popover);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [anchor, place, width]);
  return (
    <div
      ref={element}
      id={id}
      popover="auto"
      role={role}
      aria-label={label}
      tabIndex={-1}
      style={{ width }}
      onBeforeToggle={(e: ToggleEvent<HTMLDivElement>) => {
        if (e.newState === "open") {
          opener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
            ? document.activeElement
            : document.getElementById(anchor);
          onOpen?.();
          placeAt(e.currentTarget, anchor, place, width);
        } else onClose?.();
      }}
      onToggle={(e: ToggleEvent<HTMLDivElement>) => {
        const popover = e.currentTarget;
        if (e.newState === "open") {
          placeAt(popover, anchor, place, width);
          const target = popover.querySelector<HTMLElement>("[data-autofocus]:not(:disabled)")
            ?? popover.querySelector<HTMLElement>(role === "menu" ? '[role="menuitem"]:not(:disabled)' : "input:not(:disabled), button:not(:disabled), textarea:not(:disabled)");
          (target ?? popover).focus({ preventScroll: true });
        } else if (opener.current?.isConnected && (document.activeElement === document.body || popover.contains(document.activeElement))) {
          opener.current.focus({ preventScroll: true });
        }
      }}
      onKeyDown={(event) => {
        if (role !== "menu" || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'));
        if (items.length === 0) return;
        event.preventDefault();
        const current = items.findIndex((item) => item === document.activeElement);
        const next = event.key === "Home" ? 0
          : event.key === "End" ? items.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}
      className={`fixed inset-auto m-0 max-h-[calc(100vh-16px)] max-w-[calc(100vw-16px)] flex-col rounded-layer border-0 bg-panel p-0 text-ink shadow-[var(--shadow),inset_0_0_0_1px_var(--line2)] [&:popover-open]:flex ${role === "menu" ? "overflow-y-auto [&>[role=menuitem]]:shrink-0" : "overflow-hidden"} ${className}`}
    >
      {children}
    </div>
  );
}

export function PopoverHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-10 flex-none items-center gap-2 border-b border-line2 px-4 py-2 text-small text-ink2">
      <b className="lab text-ink">{title}</b>
      {children}
    </div>
  );
}

export function PopoverBody({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 py-3">{children}</div>;
}

export function PopoverFooter({ children }: { children: ReactNode }) {
  return <div className="flex flex-none flex-wrap items-center gap-2 border-t border-line2 px-4 py-3">{children}</div>;
}
