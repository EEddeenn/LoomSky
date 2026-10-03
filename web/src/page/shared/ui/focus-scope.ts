"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

type FocusOptions = {
  kind: "dialog" | "confirmation" | "panel";
  active?: boolean;
  enabled(): boolean;
  initialFocus?(): HTMLElement | null;
  onEscape(): void;
};
type FocusScope = FocusOptions & {
  element: HTMLElement;
  lastFocused: HTMLElement | null;
  returnTo: HTMLElement | null;
  entered: boolean;
};

const scopes = new Set<FocusScope>();
let owner: FocusScope | null = null;

export function hasInputHistory(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement && !target.readOnly && !target.disabled
    && ["text", "search", "email", "url", "tel", "password", "number"].includes(target.type)
    || target instanceof HTMLTextAreaElement && !target.readOnly && !target.disabled
    || target instanceof HTMLElement && target.isContentEditable;
}

function available(element: HTMLElement | null): element is HTMLElement {
  return element !== null && element.isConnected && element.getClientRects().length > 0
    && !element.matches(":disabled") && element.closest("[inert]") === null;
}

function focusable(element: HTMLElement): HTMLElement[] {
  return Array.from(element.querySelectorAll<HTMLElement>(
    'button:not(:disabled),input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex]',
  )).filter((item) => item.tabIndex >= 0 && available(item));
}

function focus(scope: FocusScope): void {
  const initial = scope.initialFocus?.() ?? null;
  const target = available(scope.lastFocused) && scope.element.contains(scope.lastFocused) ? scope.lastFocused
    : available(initial) && scope.element.contains(initial) ? initial
      : focusable(scope.element)[0] ?? scope.element;
  target.focus({ preventScroll: true });
}

function restore(target: HTMLElement | null): void {
  queueMicrotask(() => {
    if (owner !== null) return;
    if (available(target) && target !== document.body) {
      target.focus({ preventScroll: true });
      if (document.activeElement === target) return;
    }
    const main = document.querySelector<HTMLElement>("main");
    if (!available(main)) return;
    const tabIndex = main.getAttribute("tabindex");
    main.tabIndex = -1;
    main.focus({ preventScroll: true });
    if (tabIndex === null) main.removeAttribute("tabindex");
    else main.setAttribute("tabindex", tabIndex);
  });
}

function synchronize(): void {
  const enabled = Array.from(scopes).filter((scope) => scope.enabled() && available(scope.element));
  const next = enabled.findLast((scope) => scope.kind === "panel")
    ?? enabled.findLast((scope) => scope.kind === "confirmation")
    ?? enabled.findLast((scope) => scope.kind === "dialog")
    ?? null;
  if (next === owner) return;
  const previous = owner;
  if (previous !== null && document.activeElement instanceof HTMLElement && previous.element.contains(document.activeElement)) {
    previous.lastFocused = document.activeElement;
  }
  if (next !== null && !next.entered) {
    next.returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    next.entered = true;
  }
  owner = next;
  if (next !== null) {
    if (document.querySelector(":popover-open") === null) focus(next);
  } else if (previous !== null) restore(previous.returnTo);
}

function keyboard(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing) return;
  synchronize();
  const popover = document.querySelector(":popover-open");
  const target = event.target;
  const inside = target instanceof Node && (popover?.contains(target) || owner?.element.contains(target));
  const modal = Array.from(scopes).some((scope) => available(scope.element)
    && (scope.kind === "dialog" || scope.kind === "confirmation" && scope.enabled()));
  if ((event.ctrlKey || event.metaKey) && (modal || popover !== null || owner?.kind === "panel" && inside)) {
    const key = event.key.toLowerCase();
    if (key === "s" || key === "z" || key === "y") {
      const editable = inside && hasInputHistory(target);
      if (key === "s" || !editable) event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
  }
  if (popover !== null) return;
  const scope = owner;
  if (scope === null) return;
  if (event.key === "Escape" && scope.kind !== "panel") {
    event.preventDefault();
    event.stopImmediatePropagation();
    scope.onEscape();
  } else if (event.key === "Tab" && scope.kind !== "panel") {
    const items = focusable(scope.element);
    const active = document.activeElement;
    const first = items[0] ?? scope.element;
    const last = items.at(-1) ?? scope.element;
    if (!items.some((item) => item === active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

function dismissPanel(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.key !== "Escape" || document.querySelector(":popover-open") !== null || owner?.kind !== "panel") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  owner.onEscape();
}

function focused(event: FocusEvent): void {
  if (owner !== null && event.target instanceof HTMLElement && owner.element.contains(event.target)) owner.lastFocused = event.target;
}

export function useFocusScope(element: RefObject<HTMLElement | null>, options: FocusOptions): void {
  const scope = useRef<FocusScope | null>(null);
  useLayoutEffect(() => {
    if (options.active === false || element.current === null) return;
    const current: FocusScope = { ...options, element: element.current, lastFocused: null, returnTo: null, entered: false };
    scope.current = current;
    if (scopes.size === 0) {
      window.addEventListener("keydown", keyboard, true);
      window.addEventListener("keydown", dismissPanel);
      window.addEventListener("focusin", focused, true);
    }
    scopes.add(current);
    synchronize();
    return () => {
      scopes.delete(current);
      scope.current = null;
      synchronize();
      if (scopes.size === 0) {
        window.removeEventListener("keydown", keyboard, true);
        window.removeEventListener("keydown", dismissPanel);
        window.removeEventListener("focusin", focused, true);
      }
    };
  }, [element, options.kind, options.active]);
  useLayoutEffect(() => {
    if (scope.current === null) return;
    Object.assign(scope.current, options);
    synchronize();
  });
}
