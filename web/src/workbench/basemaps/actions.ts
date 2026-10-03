import { reportProblem, resolveProblem } from "@/workbench/feedback";
import { basemaps, removeBasemap } from "./state";

export function requestBasemapRemoval(url: string): void {
  const state = basemaps.get();
  const target = state.list.find((basemap) => basemap.url === url) ?? state.unopened.find((basemap) => basemap.url === url);
  if (target === undefined) return;
  const problem = `basemap:${url}:remove`;
  void removeBasemap(url).then(
    () => resolveProblem(problem),
    (error: unknown) => reportProblem({
      id: problem, level: "error", scope: "Basemaps", title: "Could not remove basemap",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
}
