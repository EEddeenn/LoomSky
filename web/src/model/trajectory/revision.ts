import { sha256 } from "@/core";
import type { TrajectorySource } from "./record";

export function trajectoryDigest(source: TrajectorySource): string {
  return sha256(new TextEncoder().encode(source.text));
}
