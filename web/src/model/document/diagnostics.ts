import type { DocumentDiagnostic, DocumentKind, TextDocument } from "./types";
import { jsonPath } from "./text";

export function diagnosticLocation(diagnostic: DocumentDiagnostic): string {
  const source = diagnostic.source ?? "";
  if (!(diagnostic.line !== undefined && diagnostic.line > 0)) return source;
  return `${source === "" ? "line " : `${source}:`}${diagnostic.line}${(diagnostic.column ?? 0) > 0 ? `:${diagnostic.column}` : ""}`;
}

export function diagnosticRange(doc: TextDocument, diagnostic: DocumentDiagnostic): { from: number; to: number } {
  if (diagnostic.file !== doc.kind) return { from: 0, to: 0 };
  const text = doc.text();
  let from = 0;
  let to = 1;
  if (!diagnostic.source && (diagnostic.line ?? 0) > 0) {
    const lines = text.split("\n");
    const line = Math.min(diagnostic.line ?? 1, lines.length) - 1;
    from = lines.slice(0, line).reduce((offset, value) => offset + value.length + 1, 0);
    let bytes = Math.max(0, (diagnostic.column ?? 1) - 1);
    for (const char of lines[line] ?? "") {
      const code = char.codePointAt(0) ?? 0;
      const width = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
      if (bytes < width) break;
      bytes -= width;
      from += char.length;
    }
    to = from + 1;
  } else {
    const path = jsonPath(diagnostic.path);
    const range = doc.range(path);
    if (range !== null) {
      from = range.from;
      to = doc.value(path) !== undefined ? range.to : range.from + 1;
    }
  }
  return { from: Math.max(0, Math.min(from, text.length)), to: Math.max(0, Math.min(Math.max(to, from + 1), text.length)) };
}


export function pathKey(kind: DocumentKind, path: readonly (string | number)[]): string {
  return `${kind}:${path.map((p) => (typeof p === "number" ? `[${p}]` : p)).join(".").replace(/\.\[/g, "[")}`;
}

export function diagnosticKey(diagnostic: DocumentDiagnostic): string {
  return `${diagnostic.file}:${diagnostic.path}`;
}

export function diagnosticsAt(doc: TextDocument, path: readonly (string | number)[], scope: "self" | "subtree" = "subtree"): DocumentDiagnostic[] {
  const key = pathKey(doc.kind, path);
  return doc.diagnostics.filter((diagnostic) => {
    const candidateKey = diagnosticKey(diagnostic);
    return candidateKey === key || (scope === "subtree" && (candidateKey.startsWith(`${key}[`) || candidateKey.startsWith(`${key}.`)));
  });
}
