import { isRecord, type Download } from "@/core";
import { reserveInput } from "@/io/input";
import type { ResourceWriteOptions } from "@/io/storage";
import { inputFileName } from "@/model/scenario";
import type { GeneratedTrack, TrajectorySource } from "@/model/trajectory";
import { createTrajectoryDocument } from "./collection";
import type { TrajectoryDoc } from "./document";

export async function importTrajectory(file: File, options: ResourceWriteOptions = {}): Promise<TrajectoryDoc> {
  options.signal?.throwIfAborted();
  if (!/\.json$/i.test(file.name)) throw new Error("Choose a trajectory JSON file");
  const release = reserveInput(file.size, options.signal);
  try {
    const text = await file.text();
    options.signal?.throwIfAborted();
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (error) {
      throw new Error(`${file.name} contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isRecord(value)) throw new Error(`${file.name} must contain a trajectory JSON object`);
    const name = file.name.replace(/\.[^.]+$/, "");
    return await createTrajectoryDocument({ name, source: { text } }, options);
  } finally { release(); }
}

export function exportTrajectory(name: string, source: TrajectorySource): Download {
  const filename = inputFileName(`${name || "trajectory"}.json`);
  if (filename === "") throw new Error("Enter a filename before exporting");
  return { name: filename, blob: new Blob([source.text], { type: "application/json" }) };
}

export function exportGeneratedTrajectory(filename: string, track: GeneratedTrack): Download {
  const name = inputFileName(filename);
  if (name === "") throw new Error("Enter a filename before exporting");
  return { name, blob: new Blob([track.pht.slice()], { type: "application/octet-stream" }) };
}
