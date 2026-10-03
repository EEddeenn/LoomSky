import type { PendingIssue } from "@/model/document";
import type { PlanEntity } from "@/model/trajectory";

export type Selection = PlanEntity | null;
export type Tool = "select" | "point" | "curve" | "region" | "direction";
export type EditOutcome = { ok: true } | { ok: false; message: string; level: "warning" | "error"; issue?: PendingIssue };
