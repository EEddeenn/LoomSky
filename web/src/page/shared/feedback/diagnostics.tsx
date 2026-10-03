import type { DocumentDiagnostic } from "@/model/document";
import { openProblems } from "@/workbench/feedback";
import { FeedbackIcon, feedbackClass, Spinner } from "@/page/shared/ui";
import { diagnosticProblemId } from "@/model/document";

function countsOf(diagnostics: readonly DocumentDiagnostic[]) {
  const errors = diagnostics.filter((diagnostic) => diagnostic.error).length;
  const warnings = diagnostics.length - errors;
  return { errors, warnings, first: diagnostics.find((diagnostic) => diagnostic.error) ?? diagnostics[0] };
}

function countText(errors: number, warnings: number): string {
  return [errors === 0 ? "" : `${errors} error${errors === 1 ? "" : "s"}`, warnings === 0 ? "" : `${warnings} warning${warnings === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
}

export function DiagnosticCue({ docId, diagnostics, stale = false, problemIdPrefix = "" }: { docId: string; diagnostics: readonly DocumentDiagnostic[]; stale?: boolean; problemIdPrefix?: string }) {
  const { errors, warnings, first } = countsOf(diagnostics);
  if (first === undefined) return null;
  const level = errors > 0 ? "error" : "warning";
  return (
    <button type="button" className={`inline-flex self-start items-center gap-1 text-small ${feedbackClass(level)} ${stale ? "opacity-50" : ""}`} onClick={() => openProblems(`${problemIdPrefix}${diagnosticProblemId(docId, first)}`)} aria-label={`Open Problems for ${first.path || first.file}: ${countText(errors, warnings)}`}>
      <FeedbackIcon level={level} size={14} />
      <span className="underline underline-offset-3">{countText(errors, warnings)}</span>
    </button>
  );
}

export function CheckSummary({ docId, status, diagnostics, checkingLabel = "Checking…", readyLabel = "Ready" }: {
  docId: string;
  status: "checking" | "ready" | "errors";
  diagnostics: readonly DocumentDiagnostic[];
  checkingLabel?: string;
  readyLabel?: string;
}) {
  const { errors, warnings, first } = countsOf(diagnostics);
  if (status === "checking") return <span className="inline-flex items-center gap-1.5 text-ink2"><Spinner />{checkingLabel}</span>;
  const level = status === "errors" || errors > 0 ? "error" : warnings > 0 ? "warning" : "success";
  const text = level === "error" ? countText(Math.max(1, errors), warnings) : `${readyLabel}${warnings === 0 ? "" : ` · ${countText(0, warnings)}`}`;
  const content = <><FeedbackIcon level={level} size={14} /><span>{text}</span></>;
  return first === undefined
    ? <span className={`inline-flex items-center gap-1.5 ${feedbackClass(level)}`}>{content}</span>
    : <button type="button" className={`inline-flex items-center gap-1.5 ${feedbackClass(level)}`} onClick={() => openProblems(diagnosticProblemId(docId, first))} aria-label={`Open Problems: ${text}`}>{content}</button>;
}
