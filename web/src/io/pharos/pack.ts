import type { PackedSummary, PositionFormat, SampleFormat, Window } from "@/model/bundle";
import type { System } from "@/model/gnss";
import type { Diagnostic } from "@/model/document";
import { Memory, PharosError, enumName, systemNames, type BaseLayout, type MemoryExports, type RecordLayout, type SystemIds } from "./memory";

interface Exports extends MemoryExports {
  pharos_pack_create_from_memory(json: number, len: number, files: number, count: number, out: number): number;
  pharos_pack_last_error(): number;
  pharos_pack_diag_count(p: number): number;
  pharos_pack_diag_get(p: number, index: number, out: number): number;
  pharos_pack_has_bundle(p: number): number;
  pharos_pack_info_get(p: number, out: number): number;
  pharos_pack_bytes(p: number, bytes: number, len: number): number;
  pharos_pack_describe_nav(file: number, out: number): number;
  pharos_pack_nav_coverage(description: number, entries: number, count: number): number;
  pharos_pack_nav_destroy(description: number): void;
  pharos_pack_error(p: number): number;
  pharos_pack_destroy(p: number): void;
}

type Layout = BaseLayout & {
  types: {
    pharos_pack_diag: RecordLayout<"code" | "severity" | "source" | "path" | "line" | "column" | "message">;
    pharos_pack_info: RecordLayout<"duration_ms" | "start_gps_ms" | "start_gps_sub_ms" | "leap_change_gps_ms" | "leap_seconds" | "leap_seconds_after" | "has_samples" | "sample_format" | "sample_rate_hz" | "center_hz" | "elevation_mask_deg" | "observation_interval_ms" | "position_interval_ms" | "position_format">;
    pharos_pack_file: RecordLayout<"name" | "bytes" | "len">;
    pharos_pack_coverage: RecordLayout<"system" | "leap_seconds" | "satellites" | "from_gps_ms" | "until_gps_ms">;
  };
  enums: {
    pharos_pack_status: { ok: number };
    pharos_pack_diag_code: Record<string, number>;
    pharos_pack_severity: { err: number };
    pharos_pack_iq_format: { iq2: number; iq4: number; iq8: number; iq16: number };
    pharos_pack_position_format: { ecef: number; lla: number; kml: number };
    pharos_pack_system: SystemIds;
  };
};

export type Packed = { diagnostics: Diagnostic[] } & (
  | { error: ""; summary: PackedSummary; bundle: Uint8Array<ArrayBuffer> }
  | { error: string; summary: null; bundle: null }
);
export type Coverage = { system: System; leapSeconds: number; satellites: number[]; fromGpsMs: number; untilGpsMs: number };
export type NamedBytes = { name: string; bytes: Uint8Array };

const encoder = new TextEncoder();

export class Pack {
  private readonly x: Exports;
  private readonly memory: Memory<Layout>;
  private readonly layout: Layout;
  private readonly diagnosticNames: Map<number, string>;
  private readonly packSystems: Map<number, System>;

  constructor(instance: WebAssembly.Instance) {
    this.x = instance.exports as Exports;
    this.memory = new Memory<Layout>(this.x);
    this.layout = this.memory.layout;
    this.diagnosticNames = new Map(Object.entries(this.layout.enums.pharos_pack_diag_code).map(([name, value]) => [value, name]));
    this.packSystems = systemNames(this.layout.enums.pharos_pack_system);
  }

  get memoryBytes(): number { return this.x.memory.buffer.byteLength; }

  private table<T>(files: readonly NamedBytes[], use: (table: number) => T): T {
    const held: [number, number][] = [];
    const hold = (bytes: Uint8Array) => {
      const p = this.memory.alloc(bytes.length);
      held.push([p, bytes.length]);
      new Uint8Array(this.x.memory.buffer, p, bytes.length).set(bytes);
      return p;
    };
    const { size, fields } = this.layout.types.pharos_pack_file;
    try {
      const entries = files.map((f) => ({ name: hold(encoder.encode(`${f.name}\0`)), bytes: hold(f.bytes), len: f.bytes.length }));
      const table = this.memory.alloc(size * files.length);
      held.push([table, size * files.length]);
      const v = this.memory.view();
      entries.forEach((entry, i) => {
        const at = table + size * i;
        v.setUint32(at + fields.name.offset, entry.name, true);
        v.setUint32(at + fields.bytes.offset, entry.bytes, true);
        v.setUint32(at + fields.len.offset, entry.len, true);
      });
      return use(table);
    } finally {
      for (const [p, n] of held) this.memory.free(p, n);
    }
  }

  private sampleFormat(value: number): SampleFormat {
    const formats = this.layout.enums.pharos_pack_iq_format;
    switch (value) {
      case formats.iq2: return "IQ2";
      case formats.iq4: return "IQ4";
      case formats.iq8: return "IQ8";
      case formats.iq16: return "IQ16";
      default: throw new PharosError(`unknown sample format ${value}`);
    }
  }

  private positionFormat(value: number): PositionFormat {
    const formats = this.layout.enums.pharos_pack_position_format;
    switch (value) {
      case formats.ecef: return "ECEF";
      case formats.lla: return "LLA";
      case formats.kml: return "KML";
      default: throw new PharosError(`unknown position format ${value}`);
    }
  }

  private summary(at: number): PackedSummary {
    const { fields } = this.layout.types.pharos_pack_info;
    const change = this.memory.i64(at + fields.leap_change_gps_ms.offset);
    const window: Window = {
      startGpsMs: this.memory.i64(at + fields.start_gps_ms.offset) + this.memory.f64(at + fields.start_gps_sub_ms.offset),
      durationMs: this.memory.u64(at + fields.duration_ms.offset),
      leapSeconds: this.memory.i32(at + fields.leap_seconds.offset),
      leapChangeGpsMs: change === 0 ? null : change,
      leapSecondsAfter: this.memory.i32(at + fields.leap_seconds_after.offset),
    };
    const observation = this.memory.u32(at + fields.observation_interval_ms.offset);
    const position = this.memory.u32(at + fields.position_interval_ms.offset);
    return {
      window,
      samples: this.memory.u32(at + fields.has_samples.offset) === 0 ? null : {
        format: this.sampleFormat(this.memory.u32(at + fields.sample_format.offset)),
        sampleRateHz: this.memory.u64(at + fields.sample_rate_hz.offset),
        centerHz: this.memory.i64(at + fields.center_hz.offset),
      },
      elevationMaskDeg: this.memory.f64(at + fields.elevation_mask_deg.offset),
      observation: observation === 0 ? null : { intervalMs: observation },
      position: position === 0 ? null : { intervalMs: position, format: this.positionFormat(this.memory.u32(at + fields.position_format.offset)) },
    };
  }

  pack(scenario: string, files: readonly NamedBytes[]): Packed {
    const json = encoder.encode(scenario);
    return this.memory.withBytes(json, (src) =>
      this.table(files, (table) =>
        this.memory.scratch(this.layout.pointerSize, (out) => {
          const status = this.x.pharos_pack_create_from_memory(src, json.length, table, files.length, out);
          const p = this.memory.u32(out);
          if (p === 0) return { diagnostics: [], error: this.memory.text(this.x.pharos_pack_last_error()) || `status ${status}`, summary: null, bundle: null };
          try {
            const diagnostics = this.memory.diagnostics(this.layout.types.pharos_pack_diag, this.diagnosticNames, this.layout.enums.pharos_pack_severity.err, this.x.pharos_pack_diag_count(p) >>> 0, (i, d) => this.x.pharos_pack_diag_get(p, i, d));
            if (status !== this.layout.enums.pharos_pack_status.ok || this.x.pharos_pack_has_bundle(p) === 0) return { diagnostics, error: this.memory.text(this.x.pharos_pack_error(p)), summary: null, bundle: null };
            const summary = this.memory.scratch(this.layout.types.pharos_pack_info.size, (info) => {
              this.x.pharos_pack_info_get(p, info);
              return this.summary(info);
            });
            const bundle = this.memory.bytes((bytes, len) => this.x.pharos_pack_bytes(p, bytes, len), this.layout.enums.pharos_pack_status.ok, () => this.x.pharos_pack_error(p));
            return { diagnostics, error: "", summary, bundle };
          } finally {
            this.x.pharos_pack_destroy(p);
          }
        }),
      ),
    );
  }

  describe(file: NamedBytes): Coverage[] {
    return this.table([file], (table) => this.memory.scratch(this.layout.pointerSize, (out) => {
      const status = this.x.pharos_pack_describe_nav(table, out);
      if (status !== this.layout.enums.pharos_pack_status.ok) throw new PharosError(this.memory.text(this.x.pharos_pack_last_error()) || `status ${status}`);
      const description = this.memory.u32(out);
      try {
        return this.memory.scratch(this.layout.pointerSize + this.layout.sizeSize, (entries) => {
          const count = entries + this.layout.pointerSize;
          this.x.pharos_pack_nav_coverage(description, entries, count);
          const { size, fields } = this.layout.types.pharos_pack_coverage;
          return Array.from({ length: this.memory.u32(count) }, (_, i) => {
            const at = this.memory.u32(entries) + size * i;
            const mask = this.memory.view().getBigUint64(at + fields.satellites.offset, true);
            const satellites = Array.from({ length: fields.satellites.size * 8 }, (_, s) => s + 1).filter((s) => ((mask >> BigInt(s - 1)) & 1n) === 1n);
            return {
              system: enumName(this.packSystems, this.memory.u32(at + fields.system.offset), "navigation system"),
              leapSeconds: this.memory.i32(at + fields.leap_seconds.offset),
              satellites,
              fromGpsMs: this.memory.i64(at + fields.from_gps_ms.offset),
              untilGpsMs: this.memory.i64(at + fields.until_gps_ms.offset),
            };
          });
        });
      } finally {
        this.x.pharos_pack_nav_destroy(description);
      }
    }));
  }

}
