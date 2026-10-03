"use client";

import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { Compartment, EditorSelection, EditorState, StateEffect } from "@codemirror/state";
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import { useStore } from "@/core";
import { diagnosticRange, diagnosticText, documentHistory, type TextDocument } from "@/model/document";
import { bindDocumentDispatch } from "@/workbench/documents/editing";
import { captureViewport, page } from "@/workbench/navigation";
import { bindViewport } from "@/page/shared/navigation";

const editors = new WeakMap<TextDocument, EditorView>();

const style = HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--ink)", fontWeight: "600" },
  { tag: tags.string, color: "var(--ink2)" },
  { tag: tags.number, color: "var(--ink)" },
  { tag: [tags.bool, tags.null], color: "var(--ink)", fontStyle: "italic" },
  { tag: [tags.punctuation, tags.brace, tags.squareBracket, tags.separator], color: "var(--ink3)" },
]);

const theme = EditorView.theme({
  "&": { height: "100%" },
  "&.cm-focused": { outline: "2px solid var(--focus)", outlineOffset: "-2px" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", fontSize: "13px", lineHeight: "20px" },
  ".cm-content": { padding: "8px 0", caretColor: "var(--ink)" },
  ".cm-content ::selection": { backgroundColor: "color-mix(in srgb, var(--ink) 18%, transparent)" },
  ".cm-line": { padding: "0 16px 0 0" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--inset)" },
  ".cm-gutters": { backgroundColor: "var(--face)", color: "var(--ink3)", border: "none" },
  ".cm-lineNumbers .cm-gutterElement": { minWidth: "40px", padding: "0 12px 0 0" },
  ".cm-gutter-lint": { width: "14px" },
  ".cm-gutter-lint .cm-gutterElement": { display: "grid", placeItems: "center", padding: "0" },
  ".cm-lint-marker": { width: "11px", height: "11px", content: "none", mask: "center / 11px 11px no-repeat" },
  ".cm-lint-marker-error": {
    backgroundColor: "var(--fault)",
    maskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'%3E%3Ccircle cx='12' cy='12' r='8.5'/%3E%3Cpath d='m9 9 6 6M15 9l-6 6'/%3E%3C/svg%3E")`,
  },
  ".cm-lint-marker-warning": {
    backgroundColor: "var(--warn-ink)",
    maskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linejoin='round'%3E%3Cpath d='M12 2.8 21.2 12 12 21.2 2.8 12z'/%3E%3Cpath d='M12 8v5'/%3E%3Ccircle cx='12' cy='16.2' r='.7' fill='black'/%3E%3C/svg%3E")`,
  },
  ".cm-lintRange-error, .cm-lintRange-warning": { backgroundImage: "none", textDecoration: "underline wavy", textDecorationSkipInk: "none", textUnderlineOffset: "4px" },
  ".cm-lintRange-error": { textDecorationColor: "var(--fault)" },
  ".cm-lintRange-warning": { textDecorationColor: "var(--warn)" },
  ".cm-lintPoint:after": { borderBottomColor: "var(--fault)" },
  ".cm-lintPoint-warning:after": { borderBottomColor: "var(--warn)" },
  ".cm-tooltip": { overflow: "hidden", backgroundColor: "var(--panel)", color: "var(--ink)", border: "none", borderRadius: "4px", boxShadow: "var(--shadow), inset 0 0 0 1px var(--line2)", font: "400 12px/16px var(--font-sans)" },
  ".cm-diagnostic-error": { borderLeftColor: "var(--fault)" },
  ".cm-diagnostic-warning": { borderLeftColor: "var(--warn)" },
});

const extensions = [documentHistory, json(), lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), lintGutter(), syntaxHighlighting(style), theme, keymap.of([...historyKeymap, ...defaultKeymap])];

function diagnosticsOf(doc: TextDocument): Diagnostic[] {
  const list: Diagnostic[] = [];
  for (const d of doc.diagnostics) {
    if (d.file !== doc.kind) continue;
    list.push({
      ...diagnosticRange(doc, d),
      severity: d.error ? "error" : "warning",
      message: diagnosticText(d),
    });
  }
  return list;
}

export function CodeView({ doc }: { doc: TextDocument }) {
  const visitId = useStore(page, (state) => state.visitId);
  const host = useRef<HTMLDivElement>(null);
  const releaseViewport = useRef<(() => void) | null>(null);

  useEffect(() => {
    const parent = host.current;
    if (parent === null) return;
    const access = new Compartment();
    const editable = () => [EditorState.readOnly.of(!doc.writable()), EditorView.editable.of(doc.writable())];
    const configure = (state: EditorState) => state.update({
      effects: StateEffect.reconfigure.of([
        ...extensions,
        doc.extensions ?? [],
        access.of(editable()),
        EditorView.contentAttributes.of({ "aria-label": `${doc.kind}.json` }),
        EditorState.transactionFilter.of((transaction) => {
          const editsDocument = transaction.docChanged || transaction.isUserEvent("undo") || transaction.isUserEvent("redo");
          return editsDocument && !doc.writable() ? [] : transaction;
        }),
      ]),
    }).state;
    const configured = configure(doc.state());
    doc.accept(configured);
    const v = new EditorView({
      state: configured,
      parent,
      dispatchTransactions(transactions, editor) {
        editor.update(transactions);
        doc.accept(editor.state);
      },
    });
    editors.set(doc, v);
    const unbind = bindDocumentDispatch(doc, (spec) => v.dispatch(spec));
    let writable = doc.writable();
    let diagnostics: TextDocument["diagnostics"] | null = null;
    const synchronize = () => {
      if (v.state !== doc.state()) {
        const incoming = configure(doc.state());
        const selection = v.state.selection;
        const replacement = incoming.update({ selection: EditorSelection.create(selection.ranges.map((range) => EditorSelection.range(
          Math.min(range.anchor, incoming.doc.length), Math.min(range.head, incoming.doc.length),
        )), selection.mainIndex) }).state;
        const { scrollTop, scrollLeft } = v.scrollDOM;
        v.setState(replacement);
        v.scrollDOM.scrollTop = scrollTop;
        v.scrollDOM.scrollLeft = scrollLeft;
        diagnostics = null;
        doc.accept(replacement);
      }
      if (writable !== doc.writable()) {
        writable = doc.writable();
        v.dispatch({ effects: access.reconfigure(editable()) });
      }
      if (diagnostics !== doc.diagnostics) {
        diagnostics = doc.diagnostics;
        v.dispatch(setDiagnostics(v.state, diagnosticsOf(doc)));
      }
    };
    const unsubscribe = doc.subscribe(synchronize);
    synchronize();
    return () => {
      releaseViewport.current?.();
      releaseViewport.current = null;
      unsubscribe();
      unbind();
      if (editors.get(doc) === v) editors.delete(doc);
      doc.accept(doc.state().update({ effects: StateEffect.reconfigure.of([documentHistory, doc.extensions ?? []]) }).state);
      v.destroy();
    };
  }, [doc]);

  useEffect(() => {
    const editor = editors.get(doc);
    if (editor === undefined || page.get().visitId !== visitId) return;
    const release = bindViewport(editor.scrollDOM, `${doc.kind}:json`, captureViewport());
    releaseViewport.current = release;
    return () => {
      release();
      if (releaseViewport.current === release) releaseViewport.current = null;
    };
  }, [doc, visitId]);

  return <div ref={host} className="min-h-0 flex-auto overflow-hidden bg-face" />;
}

export function focusRange(doc: TextDocument, from: number): void {
  const v = editors.get(doc);
  if (v === undefined) return;
  v.dispatch({ selection: { anchor: from }, scrollIntoView: true });
  v.focus();
}
