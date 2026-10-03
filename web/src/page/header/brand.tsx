"use client";

import { useStore } from "@/core";
import { NavLink } from "@/page/shared/navigation";
import { Icon } from "@/page/shared/ui";
import { setTheme, theme } from "@/workbench/theme";

export function Brand() {
  const currentTheme = useStore(theme, (state) => state.theme);
  const nextTheme = currentTheme === "dark" ? "light" : "dark";
  const themeLabel = `Use ${nextTheme} theme`;
  return (
    <div className="flex flex-none items-center gap-2 whitespace-nowrap">
      <button
        type="button"
        aria-label={themeLabel}
        title={themeLabel}
        onClick={() => setTheme(nextTheme)}
        className="grid size-7 place-items-center rounded-key bg-ink text-panel hover:bg-ink2"
      >
        <Icon name="logo" size={18} />
      </button>
      <NavLink destination={{ workspace: "home" }} aria-label="LoomSky home" className="rounded-key font-cond text-title font-semibold tracking-[0.14em] uppercase max-[1279px]:hidden">
        Loom<span className="font-medium text-ink2">Sky</span>
      </NavLink>
    </div>
  );
}
