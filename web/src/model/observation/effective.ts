import type { Signal, System } from "@/model/gnss";

export type EffectiveQuery = { epoch: number; system: System; svid: number; signal: Signal; groups?: number };
export type EffectiveValue = null | boolean | number | string | EffectiveValue[] | { [key: string]: EffectiveValue };
export type EffectiveGroup = { [key: string]: EffectiveValue };
export type EffectiveValues = {
  version: 1;
  epochMs: string;
  endpoint: boolean;
  target: { system: string; svid: number; signal: string; family: string };
  channel: EffectiveGroup;
  model?: EffectiveGroup;
  navigation?: EffectiveGroup;
  messages?: EffectiveGroup;
  service?: EffectiveGroup;
};
