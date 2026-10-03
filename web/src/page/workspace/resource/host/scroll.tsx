"use client";

import { useRef, type ReactNode } from "react";
import { useViewport } from "@/page/shared/navigation";

export function ScrollArea({ pane, children, className = "" }: { pane: "run" | "device" | "preview"; children: ReactNode; className?: string }) {
  const element = useRef<HTMLDivElement>(null);
  useViewport(element, `host:${pane}`);
  return (
    <div ref={element} className={`min-h-0 flex-1 overflow-auto ${className}`}>
      {children}
    </div>
  );
}
