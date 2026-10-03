import { invertedEffects } from "@codemirror/commands";
import { StateEffect, StateField } from "@codemirror/state";
import type { TrajectoryRevision } from "@/model/trajectory";

export type ScenarioBindings = Readonly<{ files: Readonly<Record<string, string>>; trajectory: TrajectoryRevision | null }>;

export const setScenarioBindings = StateEffect.define<ScenarioBindings>();
export const scenarioBindings = StateField.define<ScenarioBindings>({
  create: () => Object.freeze({ files: Object.freeze(Object.create(null) as Record<string, string>), trajectory: null }),
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setScenarioBindings)) value = effect.value;
    return value;
  },
});
export const scenarioBindingHistory = invertedEffects.of((transaction) => transaction.effects.some((effect) => effect.is(setScenarioBindings))
  ? [setScenarioBindings.of(transaction.startState.field(scenarioBindings))]
  : []);
