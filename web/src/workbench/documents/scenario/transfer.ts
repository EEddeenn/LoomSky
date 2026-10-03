import { applyEdits, modify } from "jsonc-parser";
import { isRecord, parseRecord, sha256 } from "@/core";
import { compute, type ByteSink, type ZipEntry, type TaskOptions } from "@/io/compute";
import { reserveInput } from "@/io/input";
import { fileByteLength, fileBytes, type ResourceWriteOptions } from "@/io/storage";
import { inputFileName, normalizeScenarioFiles, scenarioFileReferences, type ScenarioInputs } from "@/model/scenario";
import { immutableCopy } from "@/model/version";
import { createScenarioDocument } from "./collection";
import type { ScenarioDoc } from "./document";

function phtName(name: string): string {
  const filename = inputFileName(name);
  if (filename === "") throw new Error("Choose a trajectory filename before exporting");
  return `${filename.replace(/\.[^.]+$/, "")}.pht`;
}

function withTrajectory(text: string, name: string): string {
  return applyEdits(text, modify(text, ["trajectory"], name, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" } }));
}

export async function importScenario(file: File, options: ResourceWriteOptions = {}): Promise<ScenarioDoc> {
  options.signal?.throwIfAborted();
  if (!/\.json$/i.test(file.name)) throw new Error(`${file.name} is not a scenario JSON file`);
  const release = reserveInput(file.size, options.signal);
  try {
    const scenario = await file.text();
    options.signal?.throwIfAborted();
    let value: unknown;
    try {
      value = JSON.parse(scenario);
    } catch (error) {
      throw new Error(`${file.name} contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isRecord(value)) throw new Error(`${file.name} must contain a scenario JSON object`);
    return await createScenarioDocument({
      source: { text: normalizeScenarioFiles(scenario) }, bindings: { files: {}, trajectory: null },
    }, options);
  } finally { release(); }
}

export async function exportScenario(name: string, latest: { input: ScenarioInputs }, sink: ByteSink, options: TaskOptions = {}): Promise<{ name: string; bytes: number }> {
  options.signal?.throwIfAborted();
  const input = immutableCopy(latest.input);
  const id = inputFileName(name);
  if (id === "") throw new Error("Choose a scenario filename before exporting");
  const source = input.source;
  const named = scenarioFileReferences(parseRecord(input.scenario));
  const scenario = normalizeScenarioFiles(input.scenario);
  const encoder = new TextEncoder();
  const trajectory = named.find((reference) => reference.key === "trajectory")?.name;
  const entries = new Map<string, { source: ZipEntry["source"]; digest: string; size?: number }>();
  const add = (name: string, source: ZipEntry["source"], digest: string, size?: number) => {
    const filename = inputFileName(name);
    if (filename === "") throw new Error("An exported input needs a filename");
    const previous = entries.get(filename);
    if (previous !== undefined && previous.digest !== digest) {
      throw new Error(`Duplicate export name: ${filename}. Rename the trajectory or input.`);
    }
    entries.set(filename, { source, digest, size });
  };
  const text = (name: string, value: string) => {
    const bytes = encoder.encode(value);
    add(name, async (signal) => { signal.throwIfAborted(); return bytes; }, sha256(bytes), bytes.byteLength);
  };
  const stored = (name: string, digest: string) => add(name, async (signal) => {
    signal.throwIfAborted();
    const bytes = await fileBytes(digest);
    signal.throwIfAborted();
    if (bytes === null) throw new Error(`The input file ${name} is missing`);
    return bytes;
  }, digest);
  text("scenario.json", trajectory === undefined ? scenario : withTrajectory(scenario, phtName(trajectory)));
  if (trajectory !== undefined) {
    stored(phtName(trajectory), input.generated.digest);
    text("trajectory.json", source.text);
  }
  for (const reference of named) {
    if (reference.key === "trajectory") continue;
    const digest = Object.hasOwn(input.files, reference.name) ? input.files[reference.name] : undefined;
    if (digest === undefined) throw new Error(`The input file ${reference.name} is missing`);
    stored(reference.name, digest);
  }
  options.signal?.throwIfAborted();
  const sources = [...entries].map(([name, entry]): ZipEntry => ({
    name,
    source: async (signal) => {
      const size = entry.size ?? await fileByteLength(entry.digest);
      if (size === null) throw new Error(`The input file ${name} is missing`);
      const release = reserveInput(size, signal);
      try { return await entry.source(signal); }
      finally { release(); }
    },
  }));
  const bytes = await compute.zip(sources, sink, options);
  options.signal?.throwIfAborted();
  return { name: `${id}.zip`, bytes };
}
