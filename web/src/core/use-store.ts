"use client";

import { useSyncExternalStore } from "react";
import type { Store } from "./store";

export function useStore<T extends object, U>(store: Pick<Store<T>, "get" | "subscribe">, select: (state: T) => U): U {
  const read = () => select(store.get());
  return useSyncExternalStore(store.subscribe, read, read);
}
