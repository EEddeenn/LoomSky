import type { TaskOptions } from "@/io/compute";
import type { ArtifactFile } from "@/model/artifact";
import type { GeneratedTrack, Track } from "@/model/trajectory";
import { immutableCopy } from "@/model/version";
import { artifact, artifactBytes } from "../../builds";

export function copyTrack(track: GeneratedTrack): GeneratedTrack {
  return Object.freeze({
    ...immutableCopy({ duration: track.duration, diagnostics: track.diagnostics, inspection: track.inspection }),
    error: "", states: track.states.slice(), pht: track.pht.slice(),
  });
}

export function trackArtifact(track: Track, options: TaskOptions = {}): ReturnType<typeof artifact> {
  options.signal?.throwIfAborted();
  const header = new TextEncoder().encode(JSON.stringify({ duration: track.duration, diagnostics: track.diagnostics, inspection: track.inspection }));
  const states = new Uint8Array(track.states.buffer, track.states.byteOffset, track.states.byteLength);
  const bytes = new Uint8Array(4 + header.byteLength + states.byteLength);
  new DataView(bytes.buffer).setUint32(0, header.byteLength, true);
  bytes.set(header, 4);
  bytes.set(states, 4 + header.byteLength);
  return artifact("track.bin", bytes, options);
}

export async function readTrackArtifact(file: ArtifactFile, pht: ArtifactFile, options: TaskOptions = {}): Promise<GeneratedTrack> {
  const [bytes, trajectory] = await Promise.all([artifactBytes(file, options), artifactBytes(pht, options)]);
  if (bytes.byteLength < 4) throw new Error("The saved trajectory preview is incomplete.");
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  const offset = 4 + size;
  if (offset > bytes.byteLength || (bytes.byteLength - offset) % Float64Array.BYTES_PER_ELEMENT !== 0) throw new Error("The saved trajectory preview is invalid.");
  const header = immutableCopy(JSON.parse(new TextDecoder().decode(bytes.subarray(4, offset))) as Pick<Track, "duration" | "diagnostics" | "inspection">);
  return Object.freeze({ ...header, error: "", states: new Float64Array(bytes.slice(offset).buffer), pht: trajectory });
}
