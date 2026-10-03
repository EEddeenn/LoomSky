import { stateWidth, type GeometryInspection, type Track, type TrajectoryInspection } from "@/model/trajectory";
import { Memory, PharosError, type BaseLayout, type MemoryExports, type RecordLayout } from "./memory";

interface Exports extends MemoryExports {
  pharos_traj_build(json: number, len: number, out: number): number;
  pharos_traj_last_error(): number;
  pharos_traj_diag_count(t: number): number;
  pharos_traj_diag_get(t: number, index: number, out: number): number;
  pharos_traj_has_path(t: number): number;
  pharos_traj_info_get(t: number, out: number): number;
  pharos_traj_inspect(t: number, sampleCount: number, bytes: number, len: number): number;
  pharos_traj_bytes(t: number, bytes: number, len: number): number;
  pharos_traj_error(t: number): number;
  pharos_traj_destroy(t: number): void;
  pharos_traj_describe_geometry(json: number, len: number, subdivisions: number, out: number): number;
  pharos_traj_geometry_bytes(description: number, bytes: number, len: number): number;
  pharos_traj_geometry_destroy(description: number): void;
}

type Layout = BaseLayout & {
  types: {
    pharos_traj_diag: RecordLayout<"code" | "severity" | "source" | "path" | "line" | "column" | "message">;
    pharos_traj_info: RecordLayout<"duration_s">;
  };
  enums: {
    pharos_traj_status: { ok: number };
    pharos_traj_diag_code: Record<string, number>;
    pharos_traj_severity: { err: number };
  };
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class Traj {
  private readonly x: Exports;
  private readonly memory: Memory<Layout>;
  private readonly layout: Layout;
  private readonly diagnosticNames: Map<number, string>;

  constructor(instance: WebAssembly.Instance) {
    this.x = instance.exports as Exports;
    this.memory = new Memory<Layout>(this.x);
    this.layout = this.memory.layout;
    this.diagnosticNames = new Map(Object.entries(this.layout.enums.pharos_traj_diag_code).map(([name, value]) => [value, name]));
  }

  get memoryBytes(): number { return this.x.memory.buffer.byteLength; }

  buildTrajectory(text: string): Track {
    const json = encoder.encode(text);
    return this.memory.withBytes(json, (src) =>
      this.memory.scratch(this.layout.pointerSize, (out) =>
        this.track(this.x.pharos_traj_build(src, json.length, out), out),
      ),
    );
  }

  geometry(text: string): GeometryInspection {
    const json = encoder.encode(text);
    return this.memory.withBytes(json, (src) => this.memory.scratch(this.layout.pointerSize, (out) => {
      const status = this.x.pharos_traj_describe_geometry(src, json.length, 32, out);
      if (status !== this.layout.enums.pharos_traj_status.ok) throw new PharosError(this.memory.text(this.x.pharos_traj_last_error()) || `status ${status}`);
      const description = this.memory.u32(out);
      try {
        const bytes = this.memory.bytes((dst, len) => this.x.pharos_traj_geometry_bytes(description, dst, len), this.layout.enums.pharos_traj_status.ok, () => this.x.pharos_traj_last_error());
        return JSON.parse(decoder.decode(bytes)) as GeometryInspection;
      } finally {
        this.x.pharos_traj_geometry_destroy(description);
      }
    }));
  }

  private track(status: number, out: number): Track {
    const t = this.memory.u32(out);
    const empty: Track = { diagnostics: [], error: "", duration: 0, inspection: null, states: new Float64Array(), pht: null };
    if (t === 0) return { ...empty, error: this.memory.text(this.x.pharos_traj_last_error()) || `status ${status}` };
    try {
      const error = this.memory.text(this.x.pharos_traj_error(t));
      const diagnostics = this.memory.diagnostics(this.layout.types.pharos_traj_diag, this.diagnosticNames, this.layout.enums.pharos_traj_severity.err, this.x.pharos_traj_diag_count(t) >>> 0, (i, d) => this.x.pharos_traj_diag_get(t, i, d));
      if (this.x.pharos_traj_has_path(t) === 0) return { ...empty, diagnostics, error };

      const info = this.layout.types.pharos_traj_info;
      const duration = this.memory.scratch(info.size, (at) => {
        this.x.pharos_traj_info_get(t, at);
        return this.memory.f64(at + info.fields.duration_s.offset);
      });
      const metadata = this.memory.bytes((bytes, len) => this.x.pharos_traj_inspect(t, 2049, bytes, len), this.layout.enums.pharos_traj_status.ok, () => this.x.pharos_traj_error(t));
      const inspection = JSON.parse(decoder.decode(metadata)) as TrajectoryInspection;
      const states = new Float64Array(inspection.samples.length * stateWidth);
      for (const [index, sample] of inspection.samples.entries()) {
        states.set([sample.time, sample.latitude, sample.longitude, sample.altitude, sample.speed, sample.course], index * stateWidth);
      }
      if (status !== this.layout.enums.pharos_traj_status.ok || !inspection.solve.feasible || !inspection.solve.verified) {
        return { diagnostics, error: error || "Could not verify trajectory constraints.", duration, inspection, states, pht: null };
      }
      const pht = this.memory.bytes((bytes, len) => this.x.pharos_traj_bytes(t, bytes, len), this.layout.enums.pharos_traj_status.ok, () => this.x.pharos_traj_error(t));
      return { diagnostics, error: "", duration, inspection, states, pht };
    } finally {
      this.x.pharos_traj_destroy(t);
    }
  }

}
