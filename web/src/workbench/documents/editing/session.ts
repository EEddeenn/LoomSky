import { EditorState, type Extension, type Transaction, type TransactionSpec } from "@codemirror/state";
import { DocumentText, type DocumentDiagnostic, type DocumentKind, type TextDocument, type WriteChange } from "@/model/document";
import type { JSONPath } from "jsonc-parser";
import { dispatchDocumentTransaction } from "./dispatch";
import { discardDraftsAt, hasDrafts, subscribeDrafts, writeFieldChanges } from "./drafts";

export class EditingSession {
  private readonly document: TextDocument;
  private readonly inputListeners = new Set<() => void>();

  constructor(doc: TextDocument) { this.document = doc; }

  get pending(): boolean { return hasDrafts(this.document) || this.unapplied; }
  get unapplied(): boolean { return false; }
  get busy(): boolean { return false; }

  subscribeInputs(listener: () => void): () => void {
    this.inputListeners.add(listener);
    const unsubscribe = subscribeDrafts(this.document, listener);
    return () => { this.inputListeners.delete(listener); unsubscribe(); };
  }

  protected changed(): void {
    for (const listener of this.inputListeners) listener();
  }

  reconcile(): void {}
  leaveView(): void {}
  cancelInteraction(): boolean { return false; }
  handleHistory(_direction: "undo" | "redo"): boolean { return false; }
  reset(): void { discardDraftsAt(this.document); this.changed(); }
}


type EditorOwner = {
  id: string; kind: DocumentKind; text: string; extensions: Extension;
  writable(): boolean;
  subscribe(listener: () => void): () => void;
  significant(before: EditorState, after: EditorState): boolean;
  changed(before: EditorState, after: EditorState): void;
};

export class DocumentEditor implements TextDocument {
  private source: DocumentText;
  private revision = 1;
  status: "checking" | "ready" | "errors" = "checking";
  diagnostics: readonly DocumentDiagnostic[] = [];
  extensions: Extension;

  constructor(private readonly owner: EditorOwner) {
    this.extensions = owner.extensions;
    this.source = new DocumentText(owner.text, owner.extensions);
  }

  get id(): string { return this.owner.id; }
  get kind(): DocumentKind { return this.owner.kind; }
  get rev(): number { return this.revision; }
  subscribe(listener: () => void): () => void { return this.owner.subscribe(listener); }
  writable(): boolean { return this.owner.writable(); }
  state(): EditorState { return this.source.state; }
  text(): string { return this.source.text(); }
  value(path: JSONPath): unknown { return this.source.value(path); }
  raw(path: JSONPath): string | undefined { return this.source.raw(path); }
  range(path: JSONPath): { from: number; to: number } | null { return this.source.range(path); }
  broken(): { line: number; column: number } | null { return this.source.broken(); }

  reset(text: string, extensions: Extension = this.extensions, revision = this.revision + 1): void {
    this.extensions = extensions;
    this.source = new DocumentText(text, extensions, this.source);
    this.revision = revision;
    this.clearEvaluation();
  }

  clearEvaluation(): void {
    this.status = "checking";
    this.diagnostics = [];
  }

  write(path: JSONPath, value: unknown, options: { insert?: boolean } = {}): void {
    this.writeMany([{ path, value, ...options }]);
  }

  writeMany(changes: readonly WriteChange[]): void {
    writeFieldChanges(this, changes);
  }

  prepareTransaction(spec: TransactionSpec): Transaction | null {
    if (!this.writable()) return null;
    const transaction = this.state().update(spec);
    void transaction.state;
    return transaction;
  }

  publishTransaction(transaction: Transaction): void {
    if (!this.writable()) throw new Error("The document is no longer editable");
    if (transaction.startState !== this.state()) throw new Error("Document changed. Retry this edit.");
    if (!dispatchDocumentTransaction(this, transaction)) this.accept(transaction.state);
  }

  apply(spec: TransactionSpec): void {
    const transaction = this.prepareTransaction(spec);
    if (transaction !== null) this.publishTransaction(transaction);
  }

  accept(state: EditorState): void {
    const before = this.state();
    const changed = !before.doc.eq(state.doc) || this.owner.significant(before, state);
    if (!this.writable() && changed) return;
    this.source = new DocumentText(state, [], this.source);
    if (changed) {
      this.revision++;
      this.owner.changed(before, state);
    }
  }
}
