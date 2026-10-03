import type { FeedbackLevel } from "@/core";
import type { PageSession } from "@/workbench/navigation";

type ProblemAction = { id: string; label: string; run(): void | Promise<void>; disabled?: boolean };
export type Problem = {
  id: string;
  level: "error" | "warning";
  scope: string;
  title: string;
  message: string;
  location?: string;
  urgent?: boolean;
  actions?: readonly ProblemAction[];
};
export type ProblemRecord = Problem & { owner: string | null; created: number };

export type Confirmation = {
  id: string;
  owner?: PageSession;
  scope: string;
  title: string;
  message: string;
  details?: readonly { label: string; value: string }[];
  confirmLabel: string;
  confirm(): void | Promise<void>;
};
export type ConfirmationRecord = Confirmation & { version: number; pending: boolean };

export type Notice = { id: number; level: FeedbackLevel; message: string };

export type FeedbackState = {
  problems: readonly ProblemRecord[];
  pendingActions: ReadonlyMap<string, { actionId: string }>;
  confirmation: ConfirmationRecord | null;
  notice: Notice | null;
  selected: string | null;
  focusVersion: number;
};
