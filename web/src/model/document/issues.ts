import { diagnosticLocation } from "./diagnostics";
import type { DocumentDiagnostic, DocumentKind, DraftIssue, FieldReference } from "./types";
import { fieldKey } from "./fields";

export function diagnosticText(diagnostic: DocumentDiagnostic, { includePath = true }: { includePath?: boolean } = {}): string {
  const context = [diagnosticLocation(diagnostic), includePath ? diagnostic.path || "(root)" : ""].filter(Boolean).join(" · ");
  return `${context === "" ? "" : `${context}: `}${diagnostic.message}${diagnostic.code === "" ? "" : ` (${diagnostic.code})`}`;
}

export function diagnosticProblemId(docId: string, diagnostic: DocumentDiagnostic): string {
  const positional = Boolean(diagnostic.source) || diagnostic.path === "";
  const key = [
    diagnostic.file, diagnostic.source ?? "",
    positional ? diagnostic.line ?? 0 : 0, positional ? diagnostic.column ?? 0 : 0,
    diagnostic.path, diagnostic.code, diagnostic.message, diagnostic.error,
  ];
  return `document:${diagnostic.file}:${docId}:diagnostic:${JSON.stringify(key)}`;
}

export function draftProblemId(docId: string, kind: DocumentKind, ref: FieldReference): string {
  return `document:${kind}:${docId}:draft:${fieldKey(ref)}`;
}

export function trajectoryNameProblemId(docId: string): string {
  return `document:trajectory:${docId}:name`;
}

export function draftDiagnostic(kind: DocumentKind, issue: DraftIssue): DocumentDiagnostic {
  const path = issue.path.reduce<string>((text, part) => typeof part === "number" ? `${text}[${part}]` : `${text}${text === "" ? "" : "."}${part}`, "");
  return { file: kind, path, message: issue.message, error: true, code: "" };
}
