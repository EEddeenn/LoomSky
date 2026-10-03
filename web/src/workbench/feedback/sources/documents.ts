import { scenarioIssues, type ScenarioIssue } from "@/model/scenario";
import { diagnosticProblemId, diagnosticText, pathKey, resolveField, draftDiagnostic, draftProblemId, trajectoryNameProblemId, type DocumentDiagnostic, type DocumentKind, type DraftIssue, type TextDocument } from "@/model/document";
import { discardFieldDraft, draftIssues, fieldDraft } from "@/workbench/documents/editing";
import { gpsClock, gpsDate } from "@/model/gnss";
import { scenarioCatalog, scenarioDocuments, loadScenarioCatalog } from "@/workbench/documents/scenario";
import { loadSchemas, schemas } from "@/workbench/schemas";
import { navigate, revealDocument } from "@/workbench/navigation";
import { replaceProblems, type Problem } from "@/workbench/feedback";
import { loadTrajectoryCatalog, trajectoryCatalog, trajectoryDocuments } from "@/workbench/documents/trajectory";
import { saveDocument } from "@/workbench/documents/versions";

function fieldLocation(kind: DocumentKind, issue: DraftIssue): string {
  const path = draftDiagnostic(kind, issue).path;
  return `${kind}: ${path || "(root)"}`;
}

function describeIssue(issue: ScenarioIssue): Pick<Problem, "level" | "title" | "message" | "location"> {
  switch (issue.kind) {
    case "file": return {
      level: "error",
      title: issue.missing ? "Referenced file unavailable" : "Cannot read navigation file",
      message: issue.missing
        ? "Choose a file from Library; entering its name is not enough."
        : issue.failure ?? "Cannot read file.",
      location: `${issue.key}: ${issue.name}`,
    };
    case "ionosphere-coefficients": return {
      level: "error", title: "Unsupported ionosphere coefficients",
      message: "Remove custom coefficients or choose a compatible model.",
      location: issue.path,
    };
    case "navigation-coverage": return {
      level: "warning", title: "Window outside navigation coverage", location: issue.path,
      message: issue.coverage.stretches.length === 0
        ? "No common navigation coverage for the selected signals."
        : `Available coverage: ${issue.coverage.stretches.map((stretch) => `${gpsDate(stretch.fromGpsMs)} ${gpsClock(stretch.fromGpsMs)} → ${gpsDate(stretch.untilGpsMs)} ${gpsClock(stretch.untilGpsMs)} GPS`).join("; ")}.`,
    };
    case "publication-rules": return {
      level: "error", title: "Publication editing unavailable",
      message: "Reload the page to load publication rules.",
    };
  }
}

export function startDocumentProblems(): () => void {
  let stopped = false;
  function retryProblem(problem: Problem, retry: () => Promise<unknown>, busy = false): Problem {
    return { ...problem, actions: [{ id: "retry", label: "Retry", disabled: busy,
      run: async () => { if (!stopped && !busy) await retry().catch(() => undefined); },
    }] };
  }

  function update(): void {
    if (stopped) return;
    const scenarioState = scenarioDocuments.get();
    const trajectoryState = trajectoryDocuments.get();
    const schemaState = schemas.get();
    const problems: Problem[] = [];

    function diagnostics(doc: TextDocument, values: readonly DocumentDiagnostic[], scope: string, title: string, idPrefix = ""): void {
      for (const diagnostic of values) problems.push({
        id: `${idPrefix}${diagnosticProblemId(doc.id, diagnostic)}`,
        level: diagnostic.error ? "error" : "warning", scope, title,
        message: diagnosticText(diagnostic, { includePath: false }),
        location: `${diagnostic.file}: ${diagnostic.path || "(root)"}`,
        actions: [{ id: "locate", label: idPrefix === "" ? "Locate" : "Locate control",
          run: () => revealDocument({ kind: doc.kind, id: doc.id, target: { kind: "diagnostic", diagnostic } }),
        }],
      });
    }

    for (const doc of [...scenarioState.docs.values(), ...trajectoryState.docs.values()]) {
      const { editor, kind, id } = doc;
      const label = kind === "scenario" ? "Scenario" : "Trajectory";
      const scope = `${label} · ${kind === "scenario" ? id : doc.name || id}`;
      diagnostics(editor, editor.diagnostics, scope, kind === "scenario" ? "Scenario validation" : "Trajectory generation");
      for (const issue of draftIssues(editor)) {
        const located = resolveField(editor, issue.ref) !== null;
        problems.push({
          id: draftProblemId(id, kind, issue.ref), level: "warning", scope, title: "Unapplied field",
          message: located ? issue.message : `${issue.message} Preserved input: ${fieldDraft(editor, issue.ref)?.text ?? ""}`,
          location: fieldLocation(kind, issue),
          actions: [
            ...(located ? [{ id: "locate-input", label: "Locate input", run: () => revealDocument({ kind, id, target: { kind: "field", issue } }) }] : []),
            { id: "revert-input", label: "Revert input", run: () => discardFieldDraft(editor, issue.ref) },
          ],
        });
      }
      const message = doc.saved.issue;
      if (message !== null) {
        const problem: Problem = { id: `document:${kind}:${id}:save`, level: "error", scope,
          title: doc.saved.state.status === "conflict" ? `${label} version conflict` : `Cannot save ${label}`, message,
        };
        problems.push(doc.saved.state.status === "conflict" ? { ...problem,
          actions: [{ id: `open-${kind}`, label: `Open ${kind}`, run: () => navigate({ workspace: "resource", kind, id }) }],
        } : retryProblem(problem, async () => {
          const current = kind === "scenario" ? scenarioDocuments.get().docs.get(id) : trajectoryDocuments.get().docs.get(id);
          if (current === doc) await saveDocument(doc);
        }, doc.saved.state.status === "saving"));
      }
      if (doc.kind === "trajectory") {
        diagnostics(editor, doc.view?.previewDiagnostics ?? [], scope, "Trajectory preview", "preview:");
        if (doc.editing.nameIssue !== null) problems.push({
          id: trajectoryNameProblemId(id), level: "warning", scope, title: "Unapplied trajectory name", message: doc.editing.nameIssue,
          actions: [{ id: "locate-name", label: "Locate name", run: () => revealDocument({ kind: "trajectory", id, target: { kind: "name" } }) }],
        });
        continue;
      }
      for (const issue of doc.editing.tableIssues()) problems.push({
        id: `document:scenario:${id}:table:${JSON.stringify(issue.path)}`,
        level: "warning", scope, title: "Unapplied table input", message: `${issue.message} Preserved input: ${issue.text}`,
        location: pathKey(kind, issue.path),
        actions: [{ id: "discard-input", label: "Discard input", run: () => doc.editing.discardTableInputs(issue.path) }],
      });
      for (const issue of scenarioIssues(doc, schemaState.scenario)) {
        if (issue.diagnostic !== undefined) continue;
        const detail = describeIssue(issue);
        problems.push({
          id: issue.id, scope, ...detail,
          actions: [{ id: "locate", label: "Locate", run: () => revealDocument({ kind: "scenario", id,
            target: { kind: "diagnostic", diagnostic: { file: "scenario", path: issue.path, message: "", code: "", error: detail.level === "error" } },
          }) }],
        });
      }
    }
    for (const [kind, catalog, load] of [
      ["scenario", scenarioCatalog.get(), loadScenarioCatalog],
      ["trajectory", trajectoryCatalog.get(), loadTrajectoryCatalog],
    ] as const) {
      if (catalog.error !== null) problems.push(retryProblem({
        id: `document:${kind}:load`, level: "error", scope: `${kind === "scenario" ? "Scenario" : "Trajectory"} library`,
        title: `Cannot load ${kind === "scenario" ? "scenarios" : "trajectories"}`, message: catalog.error,
      }, load, catalog.loading));
    }
    if (schemaState.error !== null) problems.push(retryProblem({
      id: "document:schema:load", level: "error", scope: "Editor", title: "Cannot load editor schemas", message: schemaState.error,
    }, loadSchemas, schemaState.status === "loading"));
    replaceProblems("documents", problems);
  }

  const unsubscribe = [scenarioDocuments.subscribe(update), trajectoryDocuments.subscribe(update), scenarioCatalog.subscribe(update), trajectoryCatalog.subscribe(update), schemas.subscribe(update)];
  update();
  return () => {
    stopped = true;
    for (const stop of unsubscribe) stop();
    replaceProblems("documents", []);
  };
}
