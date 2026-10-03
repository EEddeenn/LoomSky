import { startOutputs } from "@/io/output";
import { startCompute } from "@/io/compute";
import { onStorageUnavailable, startStorage, startStorageSync } from "@/io/storage";
import { startBasemaps } from "./workbench/basemaps";
import { startClock } from "./workbench/clock";
import { loadScenarioCatalog, scenarioCatalog, startScenarios } from "./workbench/documents/scenario";
import { loadSchemas } from "./workbench/schemas";
import { loadTrajectoryCatalog, startTrajectories, trajectoryCatalog } from "./workbench/documents/trajectory";
import { reportProblem } from "./workbench/feedback";
import { hostOf, hosts, startHosts } from "./workbench/hosts";
import { fileLibrary, libraryFileOf, startFileLibrary } from "./workbench/files";
import { clearNavigationMemory, configureResourceIdentity, noteInteraction, refreshNavigationResource, startRouting } from "./workbench/navigation";
import { startProblemSources } from "./workbench/feedback/sources";
import { closeTransmission } from "./workbench/transmit";
import { startLibraryBrowse } from "./workbench/library";
import { clearRunTracks } from "./workbench/preview";
import { startTheme } from "./workbench/theme";
import { startOperations } from "./workbench/operations/state";
import { clearArtifactCache } from "./workbench/documents/builds/artifacts";
import { stopSavedBuilds } from "./workbench/documents/builds";
import { confirmDocumentLeave } from "./workbench/documents/leaving";

export function startWorkbench(): () => void {
  const stopCompute = startCompute();
  const closeStorage = startStorage();
  const stopOutputs = startOutputs();
  const stopOperations = startOperations();
  const stopTheme = startTheme();
  const stopStorageError = onStorageUnavailable((error) => reportProblem({
    id: "storage:unavailable", level: "error", scope: "Browser storage", title: "Reload this tab to continue saving", message: error.message,
    actions: [{ id: "reload", label: "Reload", run: () => window.location.reload() }],
  }));
  configureResourceIdentity((resource) => resource.kind === "host" ? hostOf(resource.key)?.record.id ?? null
    : resource.kind === "scenario" ? scenarioCatalog.get().entries.get(resource.id)?.head.id ?? null
      : resource.kind === "trajectory" ? trajectoryCatalog.get().entries.get(resource.id)?.head.id ?? null
        : libraryFileOf(resource.id)?.id ?? null);
  const stopRouting = startRouting(confirmDocumentLeave);
  const stopBrowse = startLibraryBrowse();
  const stopClock = startClock();
  const scenarioRuntime = startScenarios();
  const trajectoryRuntime = startTrajectories();
  const stopFiles = startFileLibrary();
  const stopBasemaps = startBasemaps();
  const stopProblems = startProblemSources();
  const stopResources = [scenarioCatalog, trajectoryCatalog, fileLibrary, hosts].map((source) => source.subscribe(refreshNavigationResource));
  const stopStorage = startStorageSync();

  void loadSchemas();
  void loadTrajectoryCatalog().catch(() => undefined);
  void loadScenarioCatalog().catch(() => undefined);
  const hostRuntime = startHosts();
  const suspend = () => { noteInteraction(); hostRuntime.setActive(false); scenarioRuntime.setActive(false); trajectoryRuntime.setActive(false); };
  const resume = () => { hostRuntime.setActive(true); scenarioRuntime.setActive(true); trajectoryRuntime.setActive(true); };
  document.addEventListener("freeze", suspend);
  document.addEventListener("resume", resume);
  window.addEventListener("pagehide", suspend);
  window.addEventListener("pageshow", resume);
  let closed = false;

  return () => {
    if (closed) return;
    closed = true;
    noteInteraction();
    document.removeEventListener("freeze", suspend);
    document.removeEventListener("resume", resume);
    window.removeEventListener("pagehide", suspend);
    window.removeEventListener("pageshow", resume);
    closeTransmission();
    const closing = [stopOperations(), hostRuntime.close(), scenarioRuntime.close(), trajectoryRuntime.close(), stopSavedBuilds()];
    for (const stop of stopResources) stop();
    stopStorage();
    stopStorageError();
    stopProblems();
    stopBasemaps();
    stopFiles();
    stopClock();
    stopRouting();
    stopBrowse();
    clearNavigationMemory();
    clearRunTracks();
    stopTheme();
    clearArtifactCache();
    stopCompute();
    void Promise.allSettled(closing).then(async () => { await stopOutputs(); await closeStorage(); });
  };
}
