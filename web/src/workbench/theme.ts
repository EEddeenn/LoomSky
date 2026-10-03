import { createStore } from "@/core";
import { onLocalChange, readLocal, writeLocal } from "@/io/storage";

export type Theme = "light" | "dark";

export const theme = createStore<{ theme: Theme }>({ theme: readLocal("theme") === "dark" ? "dark" : "light" });

export function startTheme(): () => void {
  const refresh = () => theme.set({ theme: readLocal("theme") === "dark" ? "dark" : "light" });
  refresh();
  return onLocalChange("theme", refresh);
}

export function setTheme(next: Theme): void {
  writeLocal("theme", next);
  theme.set({ theme: next });
}
