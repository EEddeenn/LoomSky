import type { Host, hostView } from "@/workbench/hosts";

export type HostDisplay = { host: Host; now: number; view: ReturnType<typeof hostView> };
