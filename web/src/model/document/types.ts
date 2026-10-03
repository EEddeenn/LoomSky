import type { EditorState, Extension, Transaction, TransactionSpec } from "@codemirror/state";
import type * as jsonc from "jsonc-parser";

export type DocumentKind = "scenario" | "trajectory";
export type DocumentDiagnostic = { file: DocumentKind; path: string; message: string; code: string; error: boolean; source?: string; line?: number; column?: number };
export type Diagnostic = Required<Omit<DocumentDiagnostic, "file">>;
export type FieldReference =
  | { kind: "path"; path: (string | number)[] }
  | { kind: "entity"; collection: (string | number)[]; id: string; field: (string | number)[] };
export type DraftIssue = { ref: FieldReference; path: (string | number)[]; message: string };
export type PendingIssue = { kind: "field"; issue: DraftIssue } | { kind: "name" | "busy"; message: string };
export type Prepared<T> = { ok: true; value: T } | { ok: false; issue: PendingIssue };
export type WriteChange = { path: jsonc.JSONPath; insert?: boolean } & (
  | { value: unknown; number?: never; json?: never }
  | { number: string; value?: never; json?: never }
  | { json: string; value?: never; number?: never }
);
export type SaveState = { status: "saved" | "pending" | "saving" } | { status: "error"; message: string };

export interface TextDocument {
  readonly id: string;
  readonly kind: DocumentKind;
  readonly rev: number;
  readonly diagnostics: readonly DocumentDiagnostic[];
  readonly status: "checking" | "ready" | "errors";
  readonly extensions?: Extension;
  subscribe(listener: () => void): () => void;
  writable(): boolean;
  state(): EditorState;
  text(): string;
  value(path: jsonc.JSONPath): unknown;
  raw(path: jsonc.JSONPath): string | undefined;
  range(path: jsonc.JSONPath): { from: number; to: number } | null;
  write(path: jsonc.JSONPath, value: unknown, options?: { insert?: boolean }): void;
  writeMany(changes: readonly WriteChange[]): void;
  prepareTransaction(spec: TransactionSpec): Transaction | null;
  publishTransaction(transaction: Transaction): void;
  accept(state: EditorState): void;
}
