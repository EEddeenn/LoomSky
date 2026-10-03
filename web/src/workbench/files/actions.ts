import { libraryFileOf, removeLibraryFile } from "./state";
import { reportProblem, requestConfirmation, resolveProblem, toast } from "@/workbench/feedback";
import { resourceRemoved } from "@/workbench/navigation";
import { startExport } from "@/workbench/operations";

export async function downloadLibraryFile(id: string): Promise<void> {
  const file = libraryFileOf(id);
  const problem = `file:${id}:export-preparation`;
  if (file === undefined) {
    reportProblem({
      id: problem, level: "error", scope: "Data files", title: "Could not export file",
      message: "This file is no longer in the Library.",
    });
    return;
  }
  resolveProblem(problem);
  await startExport({ kind: "file", resource: { kind: "file", id }, name: file.name, digest: file.digest }).done;
}

export function requestLibraryFileRemoval(id: string): void {
  const file = libraryFileOf(id);
  if (file === undefined) return;
  requestConfirmation({
    id: `library:remove-file:${id}`, scope: "Data files", title: "Remove file from Library?",
    message: "Remove this Library entry? Existing scenarios and runs keep their file content.",
    details: [{ label: "File", value: file.name }],
    confirmLabel: "Remove from Library",
    confirm: async () => {
      if (libraryFileOf(id)?.revision !== file.revision) throw new Error("This entry changed. Review it and choose Remove again.");
      await removeLibraryFile(id, file.revision);
      resourceRemoved({ kind: "file", id }, file.id);
      toast(`Removed ${file.name} from Library`);
    },
  });
}
