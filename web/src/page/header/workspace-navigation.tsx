"use client";

import { useStore } from "@/core";
import { NavLink } from "@/page/shared/navigation";
import { page } from "@/workbench/navigation";

export function WorkspaceNavigation() {
  const workspace = useStore(page, (state) => state.route.workspace);
  return (
    <nav aria-label="Workspaces" className="flex flex-none items-center gap-1">
      <NavLink destination={{ workspace: "home" }} aria-current={workspace === "home" ? "page" : undefined}
        className={`inline-flex h-8 items-center rounded-key px-3 text-small font-semibold ${workspace === "home" ? "bg-sel text-on-sel" : "text-ink2 hover:bg-hover hover:text-ink"}`}>Home</NavLink>
      <NavLink destination={{ workspace: "library" }} aria-current={workspace === "library" ? "page" : undefined}
        className={`inline-flex h-8 items-center rounded-key px-3 text-small font-semibold ${workspace === "library" ? "bg-sel text-on-sel" : "text-ink2 hover:bg-hover hover:text-ink"}`}>Library</NavLink>
    </nav>
  );
}
