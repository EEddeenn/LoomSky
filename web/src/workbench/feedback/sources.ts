import { scenarioCatalog } from "../documents/scenario";
import { hosts } from "../hosts";
import { replaceProblems } from "../feedback";
import { clock } from "../clock";
import { startDocumentProblems } from "./sources/documents";
import { startFileProblems } from "./sources/files";
import { hostProblems } from "./sources/hosts";
import { startBasemapProblems } from "./sources/maps";

export function startProblemSources(): () => void {
  const updateHosts = () => replaceProblems("hosts", hostProblems(clock.get().now));
  const stop = [startDocumentProblems(), startFileProblems(), startBasemapProblems(), hosts.subscribe(updateHosts), clock.subscribe(updateHosts), scenarioCatalog.subscribe(updateHosts)];
  updateHosts();
  return () => {
    for (const disconnect of stop.reverse()) disconnect();
    replaceProblems("hosts", []);
  };
}
