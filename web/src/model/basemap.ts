export type Basemap = { url: string; minZoom: number; maxZoom: number; bounds: [number, number, number, number]; attribution: string };
export type Refusal = { kind: "address" } | { kind: "noanswer" } | { kind: "origin" } | { kind: "http"; code: number } | { kind: "ranges" } | { kind: "format" } | { kind: "raster" };
