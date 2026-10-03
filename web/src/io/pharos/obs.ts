import type { Signal, System } from "@/model/gnss";
import type { Channel, EffectiveQuery, EffectiveValues, EpochRange, ObsCommand, TruthEpoch, TruthSatellite, TruthSignal } from "@/model/observation";
import { Memory, PharosError, enumName, systemNames, type BaseLayout, type MemoryExports, type RecordLayout, type SystemIds } from "./memory";

interface Exports extends MemoryExports {
  pharos_obs_source_create(bundle: number, len: number, out: number): number;
  pharos_obs_source_destroy(source: number): void;
  pharos_obs_last_error(): number;
  pharos_obs_output_create_dated(source: number, kind: number, created: bigint, out: number): number;
  pharos_obs_output_info_get(o: number, out: number): number;
  pharos_obs_output_set_range(o: number, first: bigint, end: bigint): number;
  pharos_obs_output_submit(o: number, command: number): number;
  pharos_obs_output_pull(o: number, maxEpochs: number, out: number): number;
  pharos_obs_output_error(o: number): number;
  pharos_obs_output_destroy(o: number): void;
  pharos_obs_truth_create(source: number, out: number): number;
  pharos_obs_truth_get(t: number, epoch: bigint, out: number): number;
  pharos_obs_truth_sky(t: number, epoch: bigint, out: number): number;
  pharos_obs_truth_visible_counts(t: number, epochs: number, count: number, counts: number): number;
  pharos_obs_truth_inspect(t: number, query: number, out: number): number;
  pharos_obs_truth_submit(t: number, command: number): number;
  pharos_obs_truth_error(t: number): number;
  pharos_obs_truth_destroy(t: number): void;
}

type Layout = BaseLayout & {
  types: {
    pharos_obs_command: RecordLayout<"apply_at_epoch" | "value" | "kind" | "system" | "svid" | "unit" | "use_default">;
    pharos_obs_inspect_query: RecordLayout<"epoch" | "system" | "svid" | "signal" | "groups">;
    pharos_obs_truth_epoch: RecordLayout<"lat_deg" | "lon_deg" | "altitude_m" | "elevation_mask_deg" | "pdop" | "hdop" | "vdop" | "satellites" | "satellite_count" | "signals" | "signal_count">;
    pharos_obs_truth_satellite: RecordLayout<"system" | "svid" | "record" | "above_mask" | "masked_out" | "azimuth_deg" | "elevation_deg">;
    pharos_obs_truth_signal: RecordLayout<"system" | "svid" | "signal" | "channel" | "commanded" | "cn0_dbhz">;
    pharos_obs_output_info: RecordLayout<"epochs" | "interval_ms" | "first_epoch" | "last_epoch">;
    pharos_obs_bytes: RecordLayout<"data" | "len">;
    pharos_obs_output_batch: RecordLayout<"data" | "len" | "completed_epochs" | "generated_through" | "has_generated" | "end">;
  };
  enums: {
    pharos_obs_status: { ok: number; end: number };
    pharos_obs_kind: { observation: number; position: number };
    pharos_obs_system: SystemIds;
    pharos_obs_signal: Record<Lowercase<Signal>, number>;
    pharos_obs_channel: Record<Channel, number>;
    pharos_obs_command_kind: Record<ObsCommand["kind"], number>;
    pharos_obs_power_unit: { dbhz: number; dbm: number; dbw: number };
  };
};

type OutputInfo = { epochs: number };
type OutputBatch = { bytes: Uint8Array<ArrayBuffer>; completedEpochs: number; end: boolean };
type SourceHandle = number & { readonly sourceHandle: unique symbol };
type TruthHandle = number & { readonly truthHandle: unique symbol };
type OutputHandle = number & { readonly outputHandle: unique symbol };


const decoder = new TextDecoder();

export class Obs {
  private readonly x: Exports;
  private readonly memory: Memory<Layout>;
  private readonly layout: Layout;
  private readonly systemIds: Record<System, number>;
  private readonly obsSystems: Map<number, System>;
  private readonly signalNames: Map<number, Signal>;
  private readonly channelNames: Map<number, Channel>;

  get memoryBytes(): number { return this.x.memory.buffer.byteLength; }

  constructor(instance: WebAssembly.Instance) {
    this.x = instance.exports as Exports;
    this.memory = new Memory<Layout>(this.x);
    this.layout = this.memory.layout;
    const { pharos_obs_system: obs, pharos_obs_signal: signal, pharos_obs_channel: channel } = this.layout.enums;
    this.systemIds = { GPS: obs.gps, BDS: obs.bds, Galileo: obs.gal, GLONASS: obs.glo };
    this.obsSystems = systemNames(obs);
    this.signalNames = new Map([
      [signal.l1ca, "L1CA"], [signal.l1c, "L1C"], [signal.l2c, "L2C"], [signal.l5, "L5"],
      [signal.b1c, "B1C"], [signal.b1i, "B1I"], [signal.b2i, "B2I"], [signal.b3i, "B3I"], [signal.b2a, "B2a"], [signal.b2b, "B2b"],
      [signal.e1, "E1"], [signal.e5a, "E5a"], [signal.e5b, "E5b"], [signal.e6, "E6"], [signal.g1, "G1"], [signal.g2, "G2"],
    ]);
    this.channelNames = new Map([
      [channel.held, "held"], [channel.masked_out, "masked_out"], [channel.not_broadcast, "not_broadcast"], [channel.no_record, "no_record"],
      [channel.below_mask, "below_mask"], [channel.outside_band, "outside_band"], [channel.no_frames, "no_frames"],
    ]);
  }

  private command(c: ObsCommand, use: (p: number) => number): number {
    const { size, fields } = this.layout.types.pharos_obs_command;
    return this.memory.scratch(size, (p) => {
      const v = this.memory.view();
      v.setBigUint64(p + fields.apply_at_epoch.offset, BigInt(c.epoch), true);
      v.setUint32(p + fields.kind.offset, this.layout.enums.pharos_obs_command_kind[c.kind], true);
      if (c.kind === "signal_power") {
        v.setUint32(p + fields.system.offset, this.systemIds[c.system], true);
        v.setUint32(p + fields.svid.offset, c.svid, true);
        v.setUint32(p + fields.use_default.offset, Number(c.level === null), true);
        if (c.level !== null) {
          v.setFloat64(p + fields.value.offset, c.level.value, true);
          v.setUint32(p + fields.unit.offset, this.layout.enums.pharos_obs_power_unit[c.level.unit], true);
        }
      } else v.setFloat64(p + fields.value.offset, c.value, true);
      return use(p);
    });
  }

  sourceCreate(bundle: Uint8Array): SourceHandle {
    return this.memory.withBytes(bundle, (src) =>
      this.memory.scratch(this.layout.pointerSize, (out) => {
        const status = this.x.pharos_obs_source_create(src, bundle.length, out);
        if (status !== this.layout.enums.pharos_obs_status.ok) throw new PharosError(this.memory.text(this.x.pharos_obs_last_error()) || `status ${status}`);
        return this.memory.u32(out) as SourceHandle;
      }),
    );
  }

  sourceDestroy(source: SourceHandle): void {
    this.x.pharos_obs_source_destroy(source);
  }

  truthCreate(source: SourceHandle): TruthHandle {
    return this.memory.scratch(this.layout.pointerSize, (out) => {
      const status = this.x.pharos_obs_truth_create(source, out);
      if (status !== this.layout.enums.pharos_obs_status.ok) throw new PharosError(this.memory.text(this.x.pharos_obs_last_error()) || `status ${status}`);
      return this.memory.u32(out) as TruthHandle;
    });
  }

  truthSubmit(t: TruthHandle, c: ObsCommand): void {
    if (this.command(c, (p) => this.x.pharos_obs_truth_submit(t, p)) !== this.layout.enums.pharos_obs_status.ok) throw new PharosError(this.memory.text(this.x.pharos_obs_truth_error(t)));
  }

  truthAt(t: TruthHandle, epoch: number, sky: boolean): TruthEpoch {
    const { size, fields } = this.layout.types.pharos_obs_truth_epoch;
    return this.memory.scratch(size, (e) => {
      const status = (sky ? this.x.pharos_obs_truth_sky : this.x.pharos_obs_truth_get)(t, BigInt(epoch), e);
      if (status !== this.layout.enums.pharos_obs_status.ok) throw new PharosError(this.memory.text(this.x.pharos_obs_truth_error(t)) || `status ${status}`);

      const satellite = this.layout.types.pharos_obs_truth_satellite;
      const satellites = Array.from({ length: this.memory.u32(e + fields.satellite_count.offset) }, (_, i): TruthSatellite => {
        const s = this.memory.u32(e + fields.satellites.offset) + satellite.size * i;
        const f = satellite.fields;
        return {
          system: enumName(this.obsSystems, this.memory.u32(s + f.system.offset), "observation system"), svid: this.memory.u32(s + f.svid.offset),
          record: this.memory.u32(s + f.record.offset) !== 0, aboveMask: this.memory.u32(s + f.above_mask.offset) !== 0, maskedOut: this.memory.u32(s + f.masked_out.offset) !== 0,
          azimuth: this.memory.f64(s + f.azimuth_deg.offset), elevation: this.memory.f64(s + f.elevation_deg.offset),
        };
      });

      const signal = this.layout.types.pharos_obs_truth_signal;
      const signals = Array.from({ length: this.memory.u32(e + fields.signal_count.offset) }, (_, i): TruthSignal => {
        const s = this.memory.u32(e + fields.signals.offset) + signal.size * i;
        const f = signal.fields;
        return {
          system: enumName(this.obsSystems, this.memory.u32(s + f.system.offset), "observation system"), svid: this.memory.u32(s + f.svid.offset),
          signal: enumName(this.signalNames, this.memory.u32(s + f.signal.offset), "signal"),
          channel: enumName(this.channelNames, this.memory.u32(s + f.channel.offset), "channel state"), commanded: this.memory.u32(s + f.commanded.offset) !== 0, cn0: this.memory.f64(s + f.cn0_dbhz.offset),
        };
      });

      return {
        lat: this.memory.f64(e + fields.lat_deg.offset), lon: this.memory.f64(e + fields.lon_deg.offset), altitude: this.memory.f64(e + fields.altitude_m.offset),
        mask: this.memory.f64(e + fields.elevation_mask_deg.offset), pdop: this.memory.f64(e + fields.pdop.offset), hdop: this.memory.f64(e + fields.hdop.offset), vdop: this.memory.f64(e + fields.vdop.offset),
        satellites, signals,
      };
    });
  }

  truthDestroy(t: TruthHandle): void {
    this.x.pharos_obs_truth_destroy(t);
  }

  truthVisibleCounts(t: TruthHandle, epochs: readonly number[]): number[] {
    return this.memory.scratch(epochs.length * 8, (input) => this.memory.scratch(epochs.length * 4, (output) => {
      const view = this.memory.view();
      epochs.forEach((epoch, i) => view.setBigUint64(input + i * 8, BigInt(epoch), true));
      const status = this.x.pharos_obs_truth_visible_counts(t, input, epochs.length, output);
      if (status !== this.layout.enums.pharos_obs_status.ok) throw new PharosError(this.memory.text(this.x.pharos_obs_truth_error(t)) || `status ${status}`);
      return Array.from({ length: epochs.length }, (_, i) => this.memory.u32(output + i * 4));
    }));
  }

  truthInspect(t: TruthHandle, query: EffectiveQuery): EffectiveValues {
    if (!Number.isSafeInteger(query.epoch) || query.epoch < 0 || !Number.isInteger(query.svid) || query.svid < 1) throw new PharosError("Choose a valid epoch and satellite");
    const layout = this.layout.types.pharos_obs_inspect_query;
    return this.memory.scratch(layout.size, (at) => {
      const view = this.memory.view();
      const fields = layout.fields;
      view.setBigUint64(at + fields.epoch.offset, BigInt(query.epoch), true);
      view.setUint32(at + fields.system.offset, this.systemIds[query.system], true);
      view.setUint32(at + fields.svid.offset, query.svid, true);
      view.setUint32(at + fields.signal.offset, this.layout.enums.pharos_obs_signal[query.signal.toLowerCase() as Lowercase<Signal>], true);
      view.setUint32(at + fields.groups.offset, query.groups ?? 0, true);
      const bytes = this.layout.types.pharos_obs_bytes;
      return this.memory.scratch(bytes.size, (out) => {
        const status = this.x.pharos_obs_truth_inspect(t, at, out);
        if (status !== this.layout.enums.pharos_obs_status.ok) throw new PharosError(this.memory.text(this.x.pharos_obs_truth_error(t)) || `status ${status}`);
        const data = this.memory.u32(out + bytes.fields.data.offset);
        const len = this.memory.u32(out + bytes.fields.len.offset);
        const result = JSON.parse(decoder.decode(new Uint8Array(this.x.memory.buffer, data, len))) as EffectiveValues;
        if (result.version !== 1) throw new PharosError("Unsupported effective values response version");
        return result;
      });
    });
  }

  outputCreate(source: SourceHandle, kind: 0 | 1, createdUnixS: number): OutputHandle {
    const output = kind === 0 ? this.layout.enums.pharos_obs_kind.observation : this.layout.enums.pharos_obs_kind.position;
    return this.memory.scratch(this.layout.pointerSize, (out) => {
      const status = this.x.pharos_obs_output_create_dated(source, output, BigInt(createdUnixS), out);
      if (status !== this.layout.enums.pharos_obs_status.ok) throw new PharosError(this.memory.text(this.x.pharos_obs_last_error()) || `status ${status}`);
      return this.memory.u32(out) as OutputHandle;
    });
  }

  outputRange(o: OutputHandle, range: EpochRange): void {
    if (this.x.pharos_obs_output_set_range(o, BigInt(range.first), BigInt(range.end)) !== this.layout.enums.pharos_obs_status.ok) throw new PharosError(this.memory.text(this.x.pharos_obs_output_error(o)));
  }

  outputSubmit(o: OutputHandle, c: ObsCommand): void {
    if (this.command(c, (p) => this.x.pharos_obs_output_submit(o, p)) !== this.layout.enums.pharos_obs_status.ok) throw new PharosError(this.memory.text(this.x.pharos_obs_output_error(o)));
  }

  outputInfo(o: OutputHandle): OutputInfo {
    const { size, fields } = this.layout.types.pharos_obs_output_info;
    return this.memory.scratch(size, (p) => {
      const status = this.x.pharos_obs_output_info_get(o, p);
      if (status !== this.layout.enums.pharos_obs_status.ok) throw new PharosError(this.memory.text(this.x.pharos_obs_output_error(o)) || `status ${status}`);
      return { epochs: this.memory.u64(p + fields.epochs.offset) };
    });
  }

  outputPull(o: OutputHandle, maxEpochs: number): OutputBatch | null {
    const { size, fields } = this.layout.types.pharos_obs_output_batch;
    return this.memory.scratch(size, (out) => {
      const status = this.x.pharos_obs_output_pull(o, maxEpochs, out);
      const codes = this.layout.enums.pharos_obs_status;
      if (status === codes.end) return null;
      if (status !== codes.ok) throw new PharosError(this.memory.text(this.x.pharos_obs_output_error(o)) || `status ${status}`);
      return {
        bytes: this.memory.copy(this.memory.u32(out + fields.data.offset), this.memory.u32(out + fields.len.offset)),
        completedEpochs: this.memory.u64(out + fields.completed_epochs.offset),
        end: this.memory.u32(out + fields.end.offset) !== 0,
      };
    });
  }

  outputDestroy(o: OutputHandle): void {
    this.x.pharos_obs_output_destroy(o);
  }
}
