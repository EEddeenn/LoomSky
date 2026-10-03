import type { System } from "@/model/gnss";

export type ObsCommand = { epoch: number } & (
  | { kind: "noise_floor_dbm_hz" | "elevation_mask"; value: number }
  | { kind: "signal_power"; system: System; svid: number; level: { unit: "dbhz" | "dbm" | "dbw"; value: number } | null }
);

export type EpochRange = { first: number; end: number };
