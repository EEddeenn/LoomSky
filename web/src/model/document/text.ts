import { history, isolateHistory } from "@codemirror/commands";
import { EditorState, type Extension, type TransactionSpec } from "@codemirror/state";
import * as jsonc from "jsonc-parser";
import type { WriteChange } from "./types";

export const documentHistory = history();
const formatting: jsonc.FormattingOptions = { insertSpaces: true, tabSize: 2, eol: "\n" };
const numberLiteral = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

export function isJsonNumberLiteral(text: string): boolean {
  return numberLiteral.test(text);
}

export function jsonPath(path: string): jsonc.JSONPath {
  return [...path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)].map((m) => m[2] !== undefined ? Number(m[2]) : m[1] ?? "");
}

export function parseError(text: string): { line: number; column: number } | null {
  const errors: jsonc.ParseError[] = [];
  jsonc.parseTree(text, errors, { allowTrailingComma: false, disallowComments: true, allowEmptyContent: false });
  const first = errors[0];
  if (first === undefined) return null;
  const before = text.slice(0, first.offset);
  return { line: before.split("\n").length, column: first.offset - before.lastIndexOf("\n") };
}

export function writeTransaction(before: string, changes: readonly WriteChange[]): TransactionSpec | null {
  let after = before;
  for (const { path, value, number, json, insert } of changes) {
    if (number !== undefined && !isJsonNumberLiteral(number)) throw new Error("Invalid JSON number");
    if (json !== undefined && parseError(json) !== null) throw new Error("Invalid JSON value");

    const literal = number ?? json;
    let marker = "\u0000literal\u0000";
    while (after.includes(JSON.stringify(marker)) || literal?.includes(JSON.stringify(marker))) marker += "\u0000";
    const edits = jsonc.modify(after, path, literal === undefined ? value : marker, { formattingOptions: formatting, isArrayInsertion: insert === true });
    after = jsonc.applyEdits(after, edits.map((edit) => ({
      ...edit,
      content: literal === undefined ? edit.content : edit.content.replace(JSON.stringify(marker), () => literal),
    })));
  }
  if (after === before) return null;

  let from = 0;
  while (from < before.length && from < after.length && before[from] === after[from]) from++;
  let to = before.length;
  let end = after.length;
  while (to > from && end > from && before[to - 1] === after[end - 1]) { to--; end--; }
  return { changes: { from, to, insert: after.slice(from, end) }, userEvent: "input.form", annotations: isolateHistory.of("full") };
}

export class DocumentText {
  readonly state: EditorState;
  private readonly content: { text: string; tree: jsonc.Node | undefined; error?: ReturnType<typeof parseError> };

  constructor(text: string | EditorState, extensions: Extension = [], previous?: DocumentText) {
    this.state = typeof text === "string" ? EditorState.create({ doc: text, extensions: [documentHistory, extensions] }) : text;
    if (previous !== undefined && previous.state.doc.eq(this.state.doc)) this.content = previous.content;
    else {
      const source = this.state.doc.toString();
      this.content = { text: source, tree: jsonc.parseTree(source, [], { allowTrailingComma: true }) };
    }
  }

  text(): string { return this.content.text; }

  broken(): ReturnType<typeof parseError> {
    if (this.content.error === undefined) this.content.error = parseError(this.content.text);
    return this.content.error;
  }

  private node(path: jsonc.JSONPath): jsonc.Node | undefined { return this.content.tree === undefined ? undefined : jsonc.findNodeAtLocation(this.content.tree, path); }

  value(path: jsonc.JSONPath): unknown {
    const node = this.node(path);
    return node === undefined ? undefined : jsonc.getNodeValue(node);
  }

  raw(path: jsonc.JSONPath): string | undefined {
    const node = this.node(path);
    if (node === undefined) return undefined;
    const value: unknown = jsonc.getNodeValue(node);
    return typeof value === "string" ? value : this.text().slice(node.offset, node.offset + node.length);
  }

  range(path: jsonc.JSONPath): { from: number; to: number } | null {
    for (let p = path; ; p = p.slice(0, -1)) {
      const node = this.node(p);
      if (node !== undefined) return { from: node.parent?.type === "property" ? node.parent.offset : node.offset, to: node.offset + node.length };
      if (p.length === 0) return null;
    }
  }
}
