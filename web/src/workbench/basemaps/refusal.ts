import { answerMs } from "@/io/basemaps";
import type { Refusal } from "@/model/basemap";

export function basemapRefusalMessage(refusal: Refusal): string {
  switch (refusal.kind) {
    case "address": return "Enter a valid URL.";
    case "noanswer": return `No answer in ${answerMs / 1000} s.`;
    case "origin": return `Server blocks ${typeof location === "undefined" ? "this page's origin" : `requests from ${location.origin}`}.`;
    case "http": return `HTTP ${refusal.code}.`;
    case "ranges": return "Server does not support byte ranges.";
    case "format": return "Not a .pmtiles archive.";
    case "raster": return "Raster tiles found. Vector tiles required.";
  }
}
