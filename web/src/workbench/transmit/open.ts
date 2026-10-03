import { saveDocument } from "@/workbench/documents/versions";
import { buildScenarioVersion } from "@/workbench/documents/scenario/builds";
import { openScenario, loadScenarioCatalog, scenarioCatalog } from "@/workbench/documents/scenario";
import { reportProblem, resolveProblem } from "@/workbench/feedback";
import { hostOf, hosts } from "@/workbench/hosts";
import { openSavedVersionPicker } from "@/workbench/library";
import { page } from "@/workbench/navigation";
import { sourceIssue } from "./configuration";
import { beginOpening, finishOpening, installTransmission, isOpening, isTransmissionSession, transmissionOwner, type TransmissionSession } from "./session";

export function chooseTransmissionScenario(session: TransmissionSession): void {
  const owner = transmissionOwner(session);
  if (owner === null) return;
  const source = session.source;
  openSavedVersionPicker({
    title: "Choose version",
    description: "Uses this saved version and build.",
    kind: "scenario",
    parent: owner,
    selected: { resourceId: source.resourceId, versionId: source.versionId, buildId: source.buildId },
    onUse(candidate) {
      if (!isTransmissionSession(session)) return false;
      installTransmission(owner, candidate.build, hostOf(session.host), 0, session.gain);
    },
  });
}

export async function openTransmit({ scenario, host, save = false, replayFromMs = 0 }: {
  scenario?: string;
  host?: string;
  save?: boolean;
  replayFromMs?: number;
}): Promise<void> {
  const owner = beginOpening();
  const selectedHost = host === undefined ? undefined : hostOf(host);
  if (host !== undefined && selectedHost === undefined) {
    finishOpening(owner);
    return;
  }
  const current = () => isOpening(owner)
    && (selectedHost === undefined || hostOf(selectedHost.key) === selectedHost);
  const scenarioId = scenario ?? page.get().lastScenario;
  let choosing = false;
  let problemId = `transmit:prepare:${scenarioId ?? "selection"}`;
  try {
    await loadScenarioCatalog();
    if (!current()) return;
    const head = scenarioId === null ? undefined : scenarioCatalog.get().entries.get(scenarioId)?.head;
    if (host !== undefined && scenario === undefined) {
      openSavedVersionPicker({
        title: "Choose scenario",
        description: "Choose a saved version, then review radio settings.",
        kind: "scenario",
        parent: owner,
        onClose: () => finishOpening(owner),
        selected: head === undefined || head.archivedAt !== null ? undefined : { resourceId: head.id, versionId: head.headVersionId },
        onUse(candidate) {
          if (!current()) return false;
          installTransmission(owner, candidate.build, selectedHost, 0);
        },
      });
      choosing = true;
      return;
    }
    if (head !== undefined && head.archivedAt !== null) throw new Error("Scenario archived. Choose an active scenario in the Library.");
    let savedVersionId = head?.headVersionId;
    if (save) {
      if (scenarioId === null) return;
      const doc = await openScenario(scenarioId, { signal: owner.signal });
      if (!current()) return;
      const saved = await saveDocument(doc);
      if (saved === null || !current()) return;
      savedVersionId = saved.id;
    }
    if (savedVersionId === undefined) return;
    resolveProblem(problemId);
    problemId = `transmit:prepare:${savedVersionId}`;
    const source = await buildScenarioVersion(savedVersionId, { signal: owner.signal });
    if (!current()) return;
    if (scenarioId !== null && source.resourceId !== scenarioId) throw new Error("Saved version belongs to another scenario.");
    const h = selectedHost ?? hosts.get().list.find((candidate) => sourceIssue(candidate, source, Date.now()) === "");
    resolveProblem(problemId);
    installTransmission(owner, source, h, replayFromMs);
  } catch (error) {
    if (!current()) return;
    reportProblem({
      id: problemId, level: "error", scope: scenario ?? "Transmission", title: "Cannot transmit this version",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (!choosing) finishOpening(owner);
  }
}
