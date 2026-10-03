import { gpsOfScale, parseStamp, timeOf, type Leap, type TimeType } from "@/model/gnss";
import { isJsonNumberLiteral, type WriteChange } from "@/model/document";
import { timeChanges } from "@/model/scenario";
import type { Path } from "@/model/schema";

export type DraftCodec = Readonly<
  | { kind: "number"; required: boolean; integer: boolean; minimum?: number; maximum?: number; exclusiveMinimum?: number; exclusiveMaximum?: number }
  | { kind: "text"; required: boolean; minLength?: number; maxLength?: number; pattern?: string }
  | { kind: "json" }
  | { kind: "hex87"; digits: number }
  | { kind: "broadcast"; limit: number }
  | { kind: "satellites"; lower: number; upper?: number; allowEmpty: boolean; bankSize?: number; enforceAllExclusive: boolean; minItems?: number; maxItems?: number; scalar: boolean }
  | { kind: "time"; type: TimeType; leap: Readonly<Leap> }
>;

export type DraftBinding = { path: Path; codec: DraftCodec; error: string };

export function prepareFieldDraft({ path, codec }: DraftBinding, text: string): readonly WriteChange[] | null {
  switch (codec.kind) {
    case "number": {
      const raw = text.trim().replace(/^−/, "-");
      if (raw === "") return codec.required ? null : [{ path, value: undefined }];
      if (!isJsonNumberLiteral(raw)) return null;
      const n = Number(raw);
      if (!Number.isFinite(n) || (codec.integer && !Number.isInteger(n))) return null;
      if ((codec.minimum !== undefined && n < codec.minimum) || (codec.maximum !== undefined && n > codec.maximum)) return null;
      if ((codec.exclusiveMinimum !== undefined && n <= codec.exclusiveMinimum) ||
          (codec.exclusiveMaximum !== undefined && n >= codec.exclusiveMaximum)) return null;
      return [{ path, number: raw }];
    }
    case "text":
      if ((codec.minLength !== undefined && text.length < codec.minLength) ||
          (codec.maxLength !== undefined && text.length > codec.maxLength)) return null;
      if (codec.pattern !== undefined && !new RegExp(codec.pattern).test(text)) return null;
      return [{ path, value: text === "" && !codec.required ? undefined : text }];
    case "json":
      if (text.trim() === "") return [{ path, value: undefined }];
      try {
        JSON.parse(text);
        return [{ path, json: text }];
      } catch {
        return null;
      }
    case "hex87":
      return new RegExp(`^[0-7][0-9a-fA-F]{${codec.digits - 1}}$`).test(text) ? [{ path, value: text }] : null;
    case "broadcast":
      return text.length >= 1 && [...text].length <= codec.limit && /^[A-Z0-9 +.\-'/:"°]+$/.test(text)
        ? [{ path, value: text }] : null;
    case "satellites": {
      if (text.trim() === "") return codec.allowEmpty ? [{ path, value: [] }] : null;
      const values: number[] = [];
      for (const token of text.trim().split(/[\s,]+/)) {
        const range = /^(\d+)(?:-(\d+))?$/.exec(token);
        if (range === null) return null;
        const from = Number(range[1]);
        const until = Number(range[2] ?? range[1]);
        if (!Number.isSafeInteger(from) || !Number.isSafeInteger(until) ||
            from < codec.lower || until < from || (codec.upper !== undefined && until > codec.upper) || until - from > 4096) return null;
        for (let value = from; value <= until; value++) values.push(value);
      }
      if (new Set(values).size !== values.length || (codec.enforceAllExclusive && values.includes(0) && values.length > 1)) return null;
      const bankSize = codec.bankSize;
      if (bankSize !== undefined && new Set(values.map((value) => Math.floor((value - 1) / bankSize))).size > 1) return null;
      if ((codec.minItems !== undefined && values.length < codec.minItems) ||
          (codec.maxItems !== undefined && values.length > codec.maxItems)) return null;
      return [{ path, value: codec.scalar && values.length === 1 ? values[0] : values }];
    }
    case "time": {
      const ms = parseStamp(text);
      return ms === null ? null : timeChanges(path, timeOf(codec.type, gpsOfScale(codec.type, ms, codec.leap), codec.leap));
    }
  }
}
