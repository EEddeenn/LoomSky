import { layers, namedFlavor, type Flavor } from "@protomaps/basemaps";
import type { ExpressionSpecification, LayerSpecification, StyleSpecification, SymbolLayerSpecification } from "maplibre-gl";
import type { Basemap } from "@/model/basemap";
import type { Theme } from "@/workbench/theme";
import { sans } from "@/page/shared/ui/fonts";

const grey: Record<Theme, Partial<Flavor>> = {
  light: {
    background: "#e9e9e9",
    earth: "#e9e9e9",
    park_a: "#d8d8d8",
    park_b: "#d8d8d8",
    wood_a: "#d8d8d8",
    wood_b: "#d8d8d8",
    scrub_a: "#d8d8d8",
    scrub_b: "#d8d8d8",
    hospital: "#dfdfdf",
    school: "#dfdfdf",
    industrial: "#dcdcdc",
    pedestrian: "#e2e2e2",
    water: "#cbcbcb",
    buildings: "#d2d2d2",
    minor_casing: "#c8c8c8",
    minor_service_casing: "#c8c8c8",
    link_casing: "#c8c8c8",
    minor_a: "#fbfbfb",
    minor_b: "#fbfbfb",
    minor_service: "#fbfbfb",
    link: "#fbfbfb",
    other: "#b0b0b0",
    major_casing_early: "#b0b0b0",
    major_casing_late: "#b0b0b0",
    highway_casing_early: "#b0b0b0",
    highway_casing_late: "#b0b0b0",
    major: "#ffffff",
    highway: "#ffffff",
    boundaries: "#a3a3a3",
    roads_label_minor: "#777777",
    roads_label_minor_halo: "#e9e9e9",
    roads_label_major: "#666666",
    roads_label_major_halo: "#e9e9e9",
    ocean_label: "#666666",
    subplace_label: "#777777",
    subplace_label_halo: "#e9e9e9",
    city_label: "#555555",
    city_label_halo: "#e9e9e9",
    state_label: "#777777",
    state_label_halo: "#e9e9e9",
    country_label: "#666666",
    address_label: "#888888",
    address_label_halo: "#e9e9e9",
  },
  dark: {
    background: "#171717",
    earth: "#171717",
    park_a: "#202020",
    park_b: "#202020",
    wood_a: "#202020",
    wood_b: "#202020",
    scrub_a: "#202020",
    scrub_b: "#202020",
    hospital: "#1d1d1d",
    school: "#1d1d1d",
    industrial: "#1e1e1e",
    pedestrian: "#1b1b1b",
    water: "#0a0a0a",
    buildings: "#252525",
    minor_casing: "#101010",
    minor_service_casing: "#101010",
    link_casing: "#101010",
    minor_a: "#2c2c2c",
    minor_b: "#2c2c2c",
    minor_service: "#2c2c2c",
    link: "#2c2c2c",
    other: "#363636",
    major_casing_early: "#0d0d0d",
    major_casing_late: "#0d0d0d",
    highway_casing_early: "#0d0d0d",
    highway_casing_late: "#0d0d0d",
    major: "#3b3b3b",
    highway: "#3b3b3b",
    boundaries: "#5c5c5c",
    roads_label_minor: "#898989",
    roads_label_minor_halo: "#171717",
    roads_label_major: "#969696",
    roads_label_major_halo: "#171717",
    ocean_label: "#858585",
    subplace_label: "#808080",
    subplace_label_halo: "#171717",
    city_label: "#b0b0b0",
    city_label_halo: "#171717",
    state_label: "#858585",
    state_label_halo: "#171717",
    country_label: "#949494",
    address_label: "#757575",
    address_label_halo: "#171717",
  },
};

function labelLayers(source: string, flavor: Flavor): SymbolLayerSpecification[] {
  const font = sans.style.fontFamily.split(",").map((family) => family.trim().replace(/^['"]|['"]$/g, ""));
  const name: ExpressionSpecification = ["coalesce", ["get", "name:en"], ["get", "name"]];
  const result: SymbolLayerSpecification[] = [];

  for (const layer of layers(source, flavor, { lang: "en", labelsOnly: true })) {
    if (layer.type !== "symbol" || layer.layout?.["text-field"] === undefined || layer.id === "roads_shields" || layer["source-layer"] === "pois") continue;
    const layout: SymbolLayerSpecification["layout"] = { ...layer.layout, "text-font": font };
    delete layout["icon-image"];
    delete layout["icon-size"];
    delete layout["icon-padding"];

    if (layer.id === "places_region") layout["text-field"] = ["step", ["zoom"], ["coalesce", ["get", "ref:en"], ["get", "ref"], ["get", "name:en"], ["get", "name"]], 6, name];
    else if (layer.id !== "address_label") layout["text-field"] = name;
    if (layer.id === "places_locality") {
      layout["text-variable-anchor"] = ["center"];
      layout["text-radial-offset"] = 0;
    }
    result.push({ ...layer, id: `${source}:${layer.id}`, layout });
  }
  return result;
}

export function styleKey(list: Basemap[], theme: Theme, labels: boolean): string {
  return `${theme}:${labels}:${list.map((b) => b.url).join("|")}`;
}

export function styleOf(list: Basemap[], theme: Theme, labels: boolean): StyleSpecification {
  const flavor: Flavor = { ...namedFlavor(theme === "light" ? "grayscale" : "black"), ...grey[theme] };
  const sources: StyleSpecification["sources"] = {};
  const stack: LayerSpecification[] = [{ id: "background", type: "background", paint: { "background-color": flavor.background } }];
  list.forEach((b, i) => {
    const source = `basemap${i}`;
    sources[source] = { type: "vector", url: `pmtiles://${b.url}`, attribution: b.attribution };
    for (const layer of layers(source, flavor)) if (layer.type !== "background") stack.push({ ...layer, id: `${source}:${layer.id}` });
  });
  if (labels) list.forEach((_, i) => stack.push(...labelLayers(`basemap${i}`, flavor)));
  return { version: 8, sources, layers: stack };
}
