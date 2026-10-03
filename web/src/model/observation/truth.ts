import type { Signal, System } from "@/model/gnss";

export const channelWords = {
  held: "with a channel",
  masked_out: "masked out",
  not_broadcast: "not broadcast",
  no_record: "no record",
  below_mask: "below the mask",
  outside_band: "outside the band",
  no_frames: "no message frames",
} as const;
export type Channel = keyof typeof channelWords;
export const held = "held";

export type TruthSatellite = { system: System; svid: number; record: boolean; aboveMask: boolean; maskedOut: boolean; azimuth: number; elevation: number };
export type TruthSignal = { system: System; svid: number; signal: Signal; channel: Channel; commanded: boolean; cn0: number };
export type TruthEpoch = {
  lat: number;
  lon: number;
  altitude: number;
  mask: number;
  pdop: number;
  hdop: number;
  vdop: number;
  satellites: TruthSatellite[];
  signals: TruthSignal[];
};
