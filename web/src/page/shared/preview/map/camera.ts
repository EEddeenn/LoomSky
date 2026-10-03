const tileSize = 512;

export type View = { x: number; y: number; zoom: number; width: number; height: number };
export type Pad = { top: number; right: number; bottom: number; left: number };

export function mercX(lon: number): number {
  return (lon + 180) / 360;
}

export function mercY(lat: number): number {
  const s = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

export function lonOf(x: number): number {
  return x * 360 - 180;
}

export function latOf(y: number): number {
  return (360 / Math.PI) * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - 90;
}

function world(v: View): number {
  return tileSize * 2 ** v.zoom;
}

export function project(v: View, mx: number, my: number): [number, number] {
  const w = world(v);
  return [(mx - v.x) * w + v.width / 2, (my - v.y) * w + v.height / 2];
}

export function unproject(v: View, px: number, py: number): [number, number] {
  const w = world(v);
  return [(px - v.width / 2) / w + v.x, (py - v.height / 2) / w + v.y];
}

export function metresPerPixel(v: View): number {
  return (40_075_016.686 * Math.cos((latOf(v.y) * Math.PI) / 180)) / world(v);
}

export type Bounds = [number, number, number, number];

function fitted(v: View, bounds: Bounds, pad: Pad, maxZoom: number): View {
  const [x0, y0, x1, y1] = bounds;
  const w = Math.max(v.width - pad.left - pad.right, 40);
  const h = Math.max(v.height - pad.top - pad.bottom, 40);
  const zoom = Math.min(maxZoom, Math.log2(Math.min(w / Math.max(x1 - x0, 1e-12), h / Math.max(y1 - y0, 1e-12)) / tileSize));
  const scale = tileSize * 2 ** zoom;
  return { ...v, zoom, x: (x0 + x1) / 2 - (pad.left - pad.right) / 2 / scale, y: (y0 + y1) / 2 - (pad.top - pad.bottom) / 2 / scale };
}

export interface Camera {
  readonly view: () => View;
  readonly onMove: (listener: () => void) => () => void;
  jump(view: Pick<View, "x" | "y" | "zoom">): void;
  fit(bounds: Bounds, pad: Pad, maxZoom: number): void;
  zoomBy(delta: number): void;
  onClick(listener: (mx: number, my: number) => void): () => void;
  setPanning(on: boolean): void;
  destroy(): void;
}

export class PlanCamera implements Camera {
  private state: View;
  private readonly listeners = new Set<() => void>();
  private readonly clicks = new Set<(mx: number, my: number) => void>();
  private readonly element: HTMLElement;
  private panning = true;
  private readonly cleanup: () => void;

  constructor(element: HTMLElement, start: Pick<View, "x" | "y" | "zoom">) {
    this.element = element;
    this.state = { ...start, width: element.clientWidth, height: element.clientHeight };
    let drag: { pointerId: number; x: number; y: number; vx: number; vy: number; moved: boolean } | null = null;
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !this.panning || drag !== null) return;
      drag = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, vx: this.state.x, vy: this.state.y, moved: false };
      element.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (drag === null || drag.pointerId !== e.pointerId || !this.panning) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      const w = world(this.state);
      this.set({ ...this.state, x: drag.vx - dx / w, y: drag.vy - dy / w });
    };
    const up = (e: PointerEvent) => {
      if (drag === null || drag.pointerId !== e.pointerId) return;
      const moved = drag.moved;
      drag = null;
      if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId);
      if (moved) return;
      const r = element.getBoundingClientRect();
      const [mx, my] = unproject(this.state, e.clientX - r.left, e.clientY - r.top);
      for (const c of this.clicks) c(mx, my);
    };
    const cancel = (e: PointerEvent) => {
      if (drag === null || drag.pointerId !== e.pointerId) return;
      drag = null;
      if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = element.getBoundingClientRect();
      this.zoomAround(-e.deltaY * 0.002, e.clientX - r.left, e.clientY - r.top);
    };
    const resize = new ResizeObserver(() => this.set({ ...this.state, width: element.clientWidth, height: element.clientHeight }));
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", cancel);
    element.addEventListener("lostpointercapture", cancel);
    element.addEventListener("wheel", wheel, { passive: false });
    resize.observe(element);
    this.cleanup = () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", cancel);
      element.removeEventListener("lostpointercapture", cancel);
      element.removeEventListener("wheel", wheel);
      resize.disconnect();
    };
  }

  private set(next: View): void {
    this.state = next;
    for (const l of this.listeners) l();
  }

  private zoomAround(delta: number, px: number, py: number): void {
    const [mx, my] = unproject(this.state, px, py);
    const zoom = Math.max(-2, Math.min(22, this.state.zoom + delta));
    const w = tileSize * 2 ** zoom;
    this.set({ ...this.state, zoom, x: mx - (px - this.state.width / 2) / w, y: my - (py - this.state.height / 2) / w });
  }

  readonly view = (): View => this.state;

  readonly onMove = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  jump(view: Pick<View, "x" | "y" | "zoom">): void {
    this.set({ ...this.state, ...view, width: this.element.clientWidth, height: this.element.clientHeight });
  }

  fit(bounds: Bounds, pad: Pad, maxZoom: number): void {
    this.jump(fitted(this.view(), bounds, pad, maxZoom));
  }

  zoomBy(delta: number): void {
    this.zoomAround(delta, this.state.width / 2, this.state.height / 2);
  }

  onClick(listener: (mx: number, my: number) => void): () => void {
    this.clicks.add(listener);
    return () => this.clicks.delete(listener);
  }

  setPanning(on: boolean): void {
    this.panning = on;
  }

  destroy(): void {
    this.cleanup();
  }
}
