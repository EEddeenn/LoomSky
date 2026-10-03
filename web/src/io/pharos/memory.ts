import type { System } from "@/model/gnss";
import type { Diagnostic } from "@/model/document";

export interface MemoryExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  pharos_wasm_layout(): number;
  pharos_alloc(len: number): number;
  pharos_free(ptr: number, len: number): void;
}

type Field = { offset: number; size: number };
export type RecordLayout<Names extends string, Arrays extends Names = never> = {
  size: number;
  align: number;
  fields: { [Name in Names]: Field & (Name extends Arrays ? { elementSize: number } : object) };
};
export type SystemIds = { gps: number; bds: number; gal: number; glo: number };
export type BaseLayout = { pointerSize: number; sizeSize: number };
type DiagnosticLayout = RecordLayout<"code" | "severity" | "source" | "path" | "line" | "column" | "message">;
export class PharosError extends Error {}

export function systemNames(ids: SystemIds): Map<number, System> {
  return new Map([[ids.gps, "GPS"], [ids.bds, "BDS"], [ids.gal, "Galileo"], [ids.glo, "GLONASS"]]);
}

export function enumName<T extends string>(names: ReadonlyMap<number, T>, id: number, kind: string): T {
  const name = names.get(id);
  if (name === undefined) throw new PharosError(`the generator returned an unknown ${kind}: ${id}`);
  return name;
}

const decoder = new TextDecoder();

export class Memory<L extends BaseLayout> {
  readonly layout: L;

  constructor(private readonly x: MemoryExports) {
    this.layout = JSON.parse(this.text(x.pharos_wasm_layout())) as L;
    if (this.layout.pointerSize !== 4 || this.layout.sizeSize !== 4) throw new PharosError("Unsupported Pharos memory layout");
  }

  view(): DataView {
    return new DataView(this.x.memory.buffer);
  }

  u32(p: number): number {
    return this.view().getUint32(p, true);
  }

  i32(p: number): number {
    return this.view().getInt32(p, true);
  }

  u64(p: number): number {
    return Number(this.view().getBigUint64(p, true));
  }

  i64(p: number): number {
    return Number(this.view().getBigInt64(p, true));
  }

  f64(p: number): number {
    return this.view().getFloat64(p, true);
  }

  alloc(n: number): number {
    const p = this.x.pharos_alloc(Math.max(n, 1)) >>> 0;
    if (p === 0) throw new PharosError("the generator's module is out of memory");
    return p;
  }

  free(p: number, n: number): void {
    this.x.pharos_free(p, Math.max(n, 1));
  }

  scratch<T>(n: number, use: (p: number) => T): T {
    const p = this.alloc(n);
    try {
      new Uint8Array(this.x.memory.buffer, p, n).fill(0);
      return use(p);
    } finally {
      this.free(p, n);
    }
  }

  withBytes<T>(bytes: Uint8Array, use: (p: number) => T): T {
    const p = this.alloc(bytes.length);
    try {
      new Uint8Array(this.x.memory.buffer, p, bytes.length).set(bytes);
      return use(p);
    } finally {
      this.free(p, bytes.length);
    }
  }

  copy(p: number, n: number): Uint8Array<ArrayBuffer> {
    return new Uint8Array(this.x.memory.buffer, p, n).slice();
  }

  text(p: number): string {
    const start = p >>> 0;
    if (start === 0) return "";
    const memory = new Uint8Array(this.x.memory.buffer);
    const end = memory.indexOf(0, start);
    return decoder.decode(memory.subarray(start, end < 0 ? memory.length : end));
  }

  diagnostics(record: DiagnosticLayout, names: ReadonlyMap<number, string>, errorSeverity: number, count: number, get: (index: number, out: number) => number): Diagnostic[] {
    const { size, fields } = record;
    return this.scratch(size, (d) => {
      const list: Diagnostic[] = [];
      for (let i = 0; i < count; i++) {
        get(i, d);
        const code = this.u32(d + fields.code.offset);
        list.push({
          code: names.get(code) ?? String(code),
          error: this.u32(d + fields.severity.offset) === errorSeverity,
          source: this.text(this.u32(d + fields.source.offset)),
          path: this.text(this.u32(d + fields.path.offset)),
          line: this.u32(d + fields.line.offset),
          column: this.u32(d + fields.column.offset),
          message: this.text(this.u32(d + fields.message.offset)),
        });
      }
      return list;
    });
  }

  bytes(get: (bytes: number, len: number) => number, ok: number, error: () => number): Uint8Array<ArrayBuffer> {
    return this.scratch(this.layout.pointerSize + this.layout.sizeSize, (out) => {
      const len = out + this.layout.pointerSize;
      const status = get(out, len);
      if (status !== ok) throw new PharosError(this.text(error()) || `status ${status}`);
      return this.copy(this.u32(out), this.u32(len));
    });
  }

}
