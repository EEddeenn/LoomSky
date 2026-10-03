"use client";

import { useStore } from "@/core";
import { page } from "@/workbench/navigation";
import { HomeWorkspace } from "./workspace/home";
import { LibraryWorkspace } from "./workspace/library";
import { ResourceDetail } from "./workspace/resource";

export function Workspace() {
  const route = useStore(page, (state) => state.route);
  return (
    <main className="relative flex min-h-0 min-w-0 flex-col">
      {route.workspace === "home" ? (
        <HomeWorkspace />
      ) : route.workspace === "library" ? (
        <LibraryWorkspace />
      ) : (
        <ResourceDetail key={`${route.kind}:${route.id}`} route={route} />
      )}
    </main>
  );
}
