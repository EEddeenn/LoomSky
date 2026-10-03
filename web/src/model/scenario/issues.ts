import { diagnosticProblemId, jsonPath, type DocumentDiagnostic } from "../document";
import type { CoverageWindow } from "./coverage";
import { scenarioFileFields, type ScenarioFileField } from "./files";
import { defaultText, lookup, type Path, type Schema } from "@/model/schema";

type ScenarioSource = {
  readonly id: string;
  readonly editor: { readonly diagnostics: readonly DocumentDiagnostic[]; value(path: Path): unknown };
  readonly files: Readonly<Record<string, string>>;
  readonly view?: { readonly described: ReadonlyMap<string, { coverage: unknown } | { error: string }> } | null;
  fileNames(key: ScenarioFileField): readonly string[];
  window(): { startGpsMs: number; durationMs: number } | null;
  coverage(window: { startGpsMs: number; durationMs: number }): CoverageWindow | null;
};

type Issue = { id: string; path: string; diagnostic?: DocumentDiagnostic };
export type ScenarioIssue = Issue & (
  | { kind: "file"; key: ScenarioFileField; name: string; missing: boolean; failure: string | null }
  | { kind: "ionosphere-coefficients" }
  | { kind: "navigation-coverage"; coverage: CoverageWindow }
  | { kind: "publication-rules" }
);

export function ionosphereAcceptsCoefficients(schema: Schema | null, model: string): boolean {
  return (schema?.["x-ionosphere-coefficients"]?.[model]?.length ?? 0) > 0;
}

export function scenarioIssues(doc: ScenarioSource, schema: Schema | null): ScenarioIssue[] {
  const issues: ScenarioIssue[] = [];
  for (const key of scenarioFileFields) {
    for (const name of doc.fileNames(key)) {
      const described = key === "ephemeris" ? doc.view?.described.get(name) : undefined;
      const missing = doc.files[name] === undefined;
      const failure = described !== undefined && "error" in described ? described.error : null;
      if (!missing && failure === null) continue;
      const diagnostic = doc.editor.diagnostics.find((item) => item.error && item.source === name && (!missing || item.code === "io_error"));
      issues.push({
        kind: "file", key, name, missing, path: key,
        id: diagnostic === undefined ? `editor:${doc.id}:${key}:files:${name}` : diagnosticProblemId(doc.id, diagnostic),
        ...(diagnostic === undefined ? {} : { diagnostic }),
        failure,
      });
    }
  }

  const modelValue = doc.editor.value(["ionosphere", "model"]);
  const model = typeof modelValue === "string" ? modelValue : defaultText(lookup(schema, ["ionosphere", "model"], (path) => doc.editor.value(path)));
  if (schema !== null && doc.editor.value(["ionosphere", "parameters"]) !== undefined && !ionosphereAcceptsCoefficients(schema, model)) {
    const diagnostic = doc.editor.diagnostics.find((item) => item.error && (item.path === "ionosphere" || item.path === "ionosphere.parameters" || item.path.startsWith("ionosphere.parameters[")));
    issues.push({
      kind: "ionosphere-coefficients", path: "ionosphere.parameters",
      id: diagnostic === undefined ? `editor:${doc.id}:ionosphere-coefficients` : diagnosticProblemId(doc.id, diagnostic),
      ...(diagnostic === undefined ? {} : { diagnostic }),
    });
  }

  const window = doc.window();
  const coverage = window === null ? null : doc.coverage(window);
  if (coverage !== null && !coverage.fits) issues.push({ kind: "navigation-coverage", id: `editor:${doc.id}:navigation-coverage`, path: "time", coverage });

  if (schema !== null && lookup(schema, ["messages"], (path) => doc.editor.value(path))?.["x-publication"] === undefined) issues.push({ kind: "publication-rules", id: `editor:${doc.id}:publication-rules`, path: "messages" });
  return issues;
}

export function scenarioProblems(doc: ScenarioSource, schema: Schema | null, drafts: readonly { path: Path }[] = []): { path: Path; error: boolean }[] {
  return [
    ...doc.editor.diagnostics.map((diagnostic) => ({ path: jsonPath(diagnostic.path), error: diagnostic.error })),
    ...scenarioIssues(doc, schema).filter((issue) => issue.diagnostic === undefined)
      .map((issue) => ({ path: jsonPath(issue.path), error: issue.kind !== "navigation-coverage" })),
    ...drafts.map(({ path }) => ({ path, error: false })),
  ];
}
