import { replaceProblems } from "@/workbench/feedback";
import { fileLibrary, reloadFileLibrary } from "@/workbench/files";

export function startFileProblems(): () => void {
  const update = () => {
    const state = fileLibrary.get();
    replaceProblems("library-files", state.error === null ? [] : [{
      id: "library:files:load", level: "error", scope: "Data files", title: "Cannot load files", message: state.error,
      actions: [{ id: "retry", label: "Retry", disabled: state.loading, run: async () => { await reloadFileLibrary().catch(() => undefined); } }],
    }]);
  };
  const unsubscribe = fileLibrary.subscribe(update);
  update();
  return () => { unsubscribe(); replaceProblems("library-files", []); };
}
