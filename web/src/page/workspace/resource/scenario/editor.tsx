"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/core";
import { draftDiagnostic, draftProblemId, resolveField } from "@/model/document";
import { scenarioFacts } from "@/model/scenario";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import { documentView, consumeDocumentFocus, page, setScenarioPreview, setView } from "@/workbench/navigation";
import { schemas } from "@/workbench/schemas";
import { openProblems } from "@/workbench/feedback";
import { CodeView } from "@/page/shared/documents/editor";
import { useEditingView } from "@/page/shared/documents/use-editing-view";
import { useViewport } from "@/page/shared/navigation";
import { useSize } from "@/page/shared/ui";
import { scenarioOutputsText, scenarioSignalsText, scenarioWindowText } from "@/page/shared/documents/scenario-summary";
import { gotoDiagnostic, gotoScenarioPath } from "./editor/diagnostics";
import { ScenarioNavigation, scenarioSections } from "./editor/navigation";
import { ScenarioPreview } from "./editor/preview";
import { MessagesSection } from "./editor/sections/messages";
import { NavSection } from "./editor/sections/navigation";
import { OutputsSection } from "./editor/sections/outputs";
import { SetupSection } from "./editor/sections/setup";
import { SignalsSection } from "./editor/sections/signals/allocation";
import { ConfigurationSplitter } from "./editor/splitter";

const sections = { setup: SetupSection, navigation: NavSection, signals: SignalsSection, messages: MessagesSection, outputs: OutputsSection };

export function Editor({ doc }: { doc: ScenarioDoc }) {
  const id = doc.id;
  const view = useStore(page, (state) => documentView(state.route));
  useEditingView(doc, view);
  const section = useStore(page, (state) => state.route.workspace === "resource" && state.route.kind === "scenario" ? state.route.tab ?? "setup" : "setup");
  const focus = useStore(page, (state) => state.documentFocus);
  const Section = sections[section];
  const preview = useStore(page, (state) => state.scenarioPreview);
  const schemaReady = useStore(schemas, (state) => state.status !== "loading");
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const size = useSize(container);
  const pane = useRef<HTMLDivElement>(null);
  useViewport(pane, `scenario:form:${section}`, view === "form" && schemaReady);
  const beside = preview.dock === "right" && (size.width === 0 || size.width >= 900);
  const maximum = Math.max(360, Math.min(620, (size.width || 1024) - 406));
  const width = Math.max(360, Math.min(maximum, preview.width));

  useEffect(() => {
    if (focus === null || focus.kind !== "scenario" || focus.id !== id) return;
    const frame = requestAnimationFrame(() => {
      if (!consumeDocumentFocus(focus)) return;
      if (focus.target.kind === "path") gotoScenarioPath(doc, focus.target.path);
      else if (focus.target.kind === "diagnostic") gotoDiagnostic(doc, focus.target.diagnostic);
      else {
        const issue = focus.target.issue;
        const path = resolveField(doc.editor, issue.ref);
        if (path === null) openProblems(draftProblemId(doc.id, doc.kind, issue.ref));
        else gotoDiagnostic(doc, draftDiagnostic(doc.kind, { ...issue, path }));
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [doc, focus, id]);

  const broken = doc.editor.broken();
  const facts = scenarioFacts(doc.editor.value([]));
  const navigationFiles = doc.fileNames("ephemeris").map((name) => name.split("/").pop());
  const summary = section === "setup" ? scenarioWindowText(doc.window(), facts.timeScale)
    : section === "signals" ? scenarioSignalsText(facts)
    : section === "navigation" ? navigationFiles.join(", ") || "No navigation file"
    : section === "outputs" ? scenarioOutputsText(facts.outputs)
    : "";
  return (
    <div
      ref={setContainer}
      aria-label="Scenario editor"
      className="grid min-h-0 min-w-0 flex-1 overflow-hidden"
      style={beside
        ? { gridTemplateColumns: `${width}px 6px minmax(0,1fr)`, gridTemplateRows: "minmax(0,1fr)" }
        : { gridTemplateColumns: "minmax(0,1fr)", gridTemplateRows: "minmax(160px,2fr) minmax(320px,3fr)" }}
    >
      <section id="scenario-configuration" aria-label="Configuration" className="@container flex min-h-0 min-w-0 flex-col bg-panel">
        {view === "json" ? <CodeView doc={doc.editor} /> : (
          <>
            <ScenarioNavigation doc={doc} current={section} />
            <div
              ref={pane}
              id="editor-pane"
              className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto overscroll-contain px-4 pt-4 pb-6"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <h3 className="m-0 text-title font-semibold">{scenarioSections.find(([key]) => key === section)?.[2]}</h3>
                {summary === "" ? null : <p className="m-0 text-small text-ink3 [overflow-wrap:anywhere]">{summary}</p>}
              </div>
              {broken !== null ? (
                <button type="button" className="self-start text-small text-fault underline underline-offset-3" onClick={() => { setView("json"); openProblems(); }}>Invalid JSON · View problem</button>
              ) : null}
              <fieldset disabled={broken !== null} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
                <Section doc={doc} />
              </fieldset>
            </div>
          </>
        )}
      </section>
      {beside ? <ConfigurationSplitter width={width} maximum={maximum} onChange={(width) => setScenarioPreview({ width })} /> : null}
      <ScenarioPreview doc={doc} section={section} beside={beside} />
    </div>
  );
}
