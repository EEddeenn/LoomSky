import { basemapRefusalMessage, basemaps } from "@/workbench/basemaps";
import { requestBasemapRemoval } from "@/workbench/basemaps";
import { replaceProblems } from "@/workbench/feedback";

export function startBasemapProblems(): () => void {
  const update = () => replaceProblems("basemaps", basemaps.get().unopened.map(({ url, refusal }) => ({
    id: `basemap:${url}:open`, level: "warning", scope: "Basemaps", title: "Saved basemap unavailable",
    message: basemapRefusalMessage(refusal), location: url,
    actions: [{ id: "remove-basemap", label: "Remove basemap", run: () => requestBasemapRemoval(url) }],
  })));
  const unsubscribe = basemaps.subscribe(update);
  update();
  return () => {
    unsubscribe();
    replaceProblems("basemaps", []);
  };
}
