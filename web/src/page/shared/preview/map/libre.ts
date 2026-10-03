import type { Map as LibreMap, StyleSpecification } from "maplibre-gl";
import { protocol } from "@/io/basemaps";
import { latOf, lonOf, mercX, mercY, type Bounds, type Camera, type Pad, type View } from "./camera";

export function hasWebgl2(): boolean {
  return document.createElement("canvas").getContext("webgl2") !== null;
}

function viewOf(map: LibreMap): View {
  const c = map.getCenter();
  const el = map.getContainer();
  return { x: mercX(c.lng), y: mercY(c.lat), zoom: map.getZoom(), width: el.clientWidth, height: el.clientHeight };
}

export class LibreCamera implements Camera {
  private readonly map: LibreMap;
  private styled: string;
  private current: View;

  constructor(map: LibreMap, styled: string) {
    this.map = map;
    this.styled = styled;
    this.current = viewOf(map);
    const moved = () => {
      this.current = viewOf(map);
    };
    map.on("move", moved);
    map.on("resize", moved);
  }

  readonly view = (): View => this.current;

  readonly onMove = (listener: () => void): (() => void) => {
    this.map.on("move", listener);
    this.map.on("resize", listener);
    return () => {
      this.map.off("move", listener);
      this.map.off("resize", listener);
    };
  };

  jump(v: Pick<View, "x" | "y" | "zoom">): void {
    this.map.jumpTo({ center: [lonOf(v.x), latOf(v.y)], zoom: v.zoom });
  }

  fit([x0, y0, x1, y1]: Bounds, pad: Pad, maxZoom: number): void {
    this.map.fitBounds(
      [
        [lonOf(x0), latOf(y1)],
        [lonOf(x1), latOf(y0)],
      ],
      { padding: pad, maxZoom, animate: false },
    );
  }

  zoomBy(delta: number): void {
    this.map.easeTo({ zoom: this.map.getZoom() + delta, duration: 150 });
  }

  onClick(listener: (mx: number, my: number) => void): () => void {
    const handler = (e: { lngLat: { lng: number; lat: number } }) => listener(mercX(e.lngLat.lng), mercY(e.lngLat.lat));
    this.map.on("click", handler);
    return () => this.map.off("click", handler);
  }

  setPanning(on: boolean): void {
    if (on) this.map.dragPan.enable();
    else this.map.dragPan.disable();
  }

  restyle(key: string, style: StyleSpecification): void {
    if (key === this.styled) return;
    this.styled = key;
    this.map.setStyle(style);
  }

  destroy(): void {
    this.map.remove();
  }
}

export async function libreCamera(container: HTMLElement, start: Pick<View, "x" | "y" | "zoom">, key: string, style: StyleSpecification): Promise<LibreCamera> {
  const libre: typeof import("maplibre-gl") = await import(/* turbopackIgnore: true */ new URL("/maplibre-gl.mjs", document.baseURI).href);
  libre.addProtocol("pmtiles", protocol.tile);
  const map = new libre.Map({
    container,
    style,
    center: [lonOf(start.x), latOf(start.y)],
    zoom: start.zoom,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    maxPitch: 0,
    renderWorldCopies: false,
  });
  map.keyboard.disableRotation();
  map.touchZoomRotate.disableRotation();
  return new LibreCamera(map, key);
}
