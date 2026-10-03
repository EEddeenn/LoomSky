import type { Transaction, TransactionSpec } from "@codemirror/state";
import type { TextDocument } from "@/model/document";

type Binding = { dispatch(transaction: Transaction | TransactionSpec): void };
const bindings = new WeakMap<TextDocument, Binding>();

export function bindDocumentDispatch(doc: TextDocument, dispatch: Binding["dispatch"]): () => void {
  const binding = { dispatch };
  bindings.set(doc, binding);
  return () => {
    if (bindings.get(doc) === binding) bindings.delete(doc);
  };
}

export function dispatchDocumentTransaction(doc: TextDocument, transaction: Transaction | TransactionSpec): boolean {
  const binding = bindings.get(doc);
  if (binding === undefined) return false;
  binding.dispatch(transaction);
  return true;
}
