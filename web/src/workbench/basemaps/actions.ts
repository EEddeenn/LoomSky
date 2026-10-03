import { requestConfirmation } from "@/workbench/feedback";
import { basemaps, removeBasemap } from "./state";

export function requestBasemapRemoval(url: string): void {
  const state = basemaps.get();
  const target = state.list.find((basemap) => basemap.url === url) ?? state.unopened.find((basemap) => basemap.url === url);
  if (target === undefined) return;
  requestConfirmation({
    id: `basemap:${url}:remove`, scope: "Basemaps", title: "Remove basemap?",
    message: "Remove from this browser's saved basemaps.",
    details: [{ label: "Address", value: url }], confirmLabel: "Remove basemap",
    confirm: () => {
      const current = basemaps.get();
      const saved = current.list.find((basemap) => basemap.url === url) ?? current.unopened.find((basemap) => basemap.url === url);
      if (saved !== target) throw new Error("This basemap changed. Review it before removing.");
      return removeBasemap(url);
    },
  });
}
