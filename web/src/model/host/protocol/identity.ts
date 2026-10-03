import { isRecord } from "@/core";

export type RunId = { boot: string; sequence: number; nonce?: never };
export type OperationId = { boot: string; sequence: number; nonce: string };

export function isRunId(value: unknown): value is RunId {
  return (
    isRecord(value) &&
    !("nonce" in value) &&
    typeof value.boot === "string" && /^[0-9a-f]{16}$/.test(value.boot) &&
    typeof value.sequence === "number" && Number.isSafeInteger(value.sequence) && value.sequence > 0
  );
}

export function isOperationId(value: unknown): value is OperationId {
  return (
    isRecord(value) &&
    typeof value.boot === "string" && /^[0-9a-f]{16}$/.test(value.boot) &&
    typeof value.sequence === "number" && Number.isSafeInteger(value.sequence) && value.sequence > 0 &&
    typeof value.nonce === "string" && /^[0-9a-f]{32}$/.test(value.nonce)
  );
}

export function sameRun(a: RunId, b: RunId): boolean {
  return a.boot === b.boot && a.sequence === b.sequence;
}

export function sameOperation(a: OperationId, b: OperationId): boolean {
  return a.boot === b.boot && a.sequence === b.sequence && a.nonce === b.nonce;
}
