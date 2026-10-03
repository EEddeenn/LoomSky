import { createStore, useStore } from "@/core";

export const clock = createStore({ now: Date.now() });

export function useNow(): number {
  return useStore(clock, (s) => s.now);
}

export function startClock(): () => void {
  const timer = setInterval(() => clock.set({ now: Date.now() }), 200);
  return () => clearInterval(timer);
}
