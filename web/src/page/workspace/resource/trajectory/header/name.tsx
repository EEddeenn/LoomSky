import { trajectoryNameProblemId } from "@/model/document";
import { inputClass } from "@/page/shared/documents/editor";
import { FeedbackIcon } from "@/page/shared/ui";
import type { TrajectoryDoc } from "@/workbench/documents/trajectory";
import { openProblems } from "@/workbench/feedback";

export function NameField({ doc }: { doc: TrajectoryDoc }) {
  const draft = doc.editing.nameDraft ?? doc.name;
  const dirty = doc.editing.nameDraft !== null;
  const invalid = doc.editing.nameIssue !== null;
  const commit = () => {
    if (!dirty || invalid) return;
    doc.commitNameDraft();
  };
  return (
    <div className="relative w-44 min-w-28 max-w-full">
      <input
        id={`trajectory-name-${doc.id}`}
        aria-label="Trajectory name"
        aria-invalid={invalid}
        aria-describedby={dirty ? `trajectory-name-${doc.id}-pending` : undefined}
        className={`${inputClass(invalid ? "warn" : null)} ${dirty ? "pr-16" : ""}`}
        value={draft}
        spellCheck={false}
        onChange={(event) => doc.editing.setNameDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape" && dirty) {
            event.preventDefault();
            event.stopPropagation();
            doc.editing.setNameDraft(doc.name);
          }
        }}
      />
      {dirty ? (
        <span id={`trajectory-name-${doc.id}-pending`} className="absolute top-0 right-2 flex h-8 items-center text-small text-ink3" title={doc.editing.nameIssue ?? "Enter or click away to apply. Esc to revert."}>
          {invalid ? <button type="button" aria-label="Trajectory name not applied" className="inline-flex items-center gap-1 text-warn-ink" onClick={() => openProblems(trajectoryNameProblemId(doc.id))}><FeedbackIcon level="warning" size={14} /></button> : <>Pending<span className="sr-only">. Enter or click away to apply. Esc to revert.</span></>}
        </span>
      ) : null}
    </div>
  );
}
