import { listOf, numberOf, recordOf, stringOf } from "@/core";
import { typeOf, type TimeType } from "@/model/gnss";

export type ScenarioOutputs = {
  observation: { intervalSeconds: number } | null;
  position: { format: string | null; intervalSeconds: number } | null;
};

export type ScenarioFacts = {
  timeScale: TimeType;
  signals: string[];
  sampleFormat: string | null;
  sampleRateMsps: number | null;
  outputs: ScenarioOutputs;
};

export function scenarioFacts(source: unknown): ScenarioFacts {
  const value = recordOf(source);
  const samples = recordOf(value?.samples);
  const observation = value?.observation;
  const position = value?.position;
  return {
    timeScale: typeOf(recordOf(value?.time)),
    signals: listOf(value?.signals).filter((signal): signal is string => typeof signal === "string"),
    sampleFormat: typeof samples?.format === "string" ? samples.format : null,
    sampleRateMsps: numberOf(samples?.sampleFreq),
    outputs: {
      observation: observation === undefined ? null : { intervalSeconds: numberOf(recordOf(observation)?.interval) ?? 1 },
      position: position === undefined ? null : { format: stringOf(recordOf(position)?.format), intervalSeconds: numberOf(recordOf(position)?.interval) ?? 1 },
    },
  };
}
