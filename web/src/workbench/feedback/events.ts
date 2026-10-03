import { createStore, save } from "@/core";
import { gpsClock, gpsOfUnix, presentLeap, utcClock } from "@/model/gnss";

export type EventKind = "alarm" | "warn" | "unknown" | "action" | "onair" | "notice" | "success";
type LogEvent = { id: number; gps: number; host: string; text: string; kind: EventKind; problemId?: string };

const MAX_LOG_EVENTS = 500;
const MAX_LOG_TEXT_BYTES = 1024 * 1024;
const MAX_EVENT_TEXT_BYTES = 16 * 1024;
const TRUNCATED = "… [truncated]";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
const truncatedBytes = encoder.encode(TRUNCATED).byteLength;
const textSizes = new WeakMap<LogEvent, number>();
let nextEventId = 0;

export const events = createStore<{ log: LogEvent[]; polite: string; assertive: string }>({ log: [], polite: "", assertive: "" });

export function log(host: string, text: string, kind: EventKind = "notice", problemId?: string): void {
  const buffer = new Uint8Array(Math.min(text.length * 3, MAX_EVENT_TEXT_BYTES));
  let { read, written } = encoder.encodeInto(text, buffer);
  if (read < text.length) {
    const prefix = encoder.encodeInto(text, buffer.subarray(0, MAX_EVENT_TEXT_BYTES - truncatedBytes));
    text = decoder.decode(buffer.subarray(0, prefix.written)) + TRUNCATED;
    written = prefix.written + truncatedBytes;
  }
  events.set((s) => {
    const entry: LogEvent = {
      id: ++nextEventId,
      gps: gpsOfUnix(Date.now(), presentLeap),
      host, text, kind,
      ...(problemId === undefined ? {} : { problemId }),
    };
    textSizes.set(entry, written);
    const retained = [entry];
    let bytes = written;
    for (const previous of s.log) {
      const size = textSizes.get(previous) ?? encoder.encode(previous.text).byteLength;
      if (retained.length === MAX_LOG_EVENTS || bytes + size > MAX_LOG_TEXT_BYTES) break;
      retained.push(previous);
      bytes += size;
    }
    return { log: retained };
  });
}

export function announce(text: string, assertive = false): void {
  events.set(assertive ? { assertive: "" } : { polite: "" });
  setTimeout(() => events.set(assertive ? { assertive: text } : { polite: text }), 30);
}

export function clearLog(): void {
  events.set({ log: [] });
}

export function downloadLog(): void {
  const lines = events
    .get()
    .log.toReversed()
    .map((e) => `${gpsClock(e.gps)} GPS · ${utcClock(e.gps, presentLeap)} UTC · ${e.host === "" ? "" : `${e.host} `}${e.text.replaceAll("`", "")}`);
  save(new Blob([`${lines.join("\n")}\n`], { type: "text/plain" }), "loomsky-events.txt");
}
