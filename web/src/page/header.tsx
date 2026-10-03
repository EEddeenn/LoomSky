"use client";

import { Brand } from "./header/brand";
import { ActivityButton } from "./header/activity-button";
import { HostBar } from "./header/host-bar";
import { StopAllButton } from "./header/stop-all-button";
import { WorkspaceNavigation } from "./header/workspace-navigation";

export function Header() {
  return (
    <header role="banner" className="relative z-40 flex h-12 min-w-0 items-center gap-2 border-b border-line2 bg-panel pr-2 pl-3">
      <Brand />
      <span aria-hidden="true" className="h-6 w-px flex-none bg-line2" />
      <WorkspaceNavigation />
      <span aria-hidden="true" className="h-6 w-px flex-none bg-line2" />
      <HostBar />
      <StopAllButton />
      <ActivityButton />
    </header>
  );
}
