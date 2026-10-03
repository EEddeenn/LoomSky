import { createStore } from "@/core";
import type { FeedbackState } from "./types";

export const feedback = createStore<FeedbackState>({ problems: [], pendingActions: new Map(), confirmation: null, notice: null, selected: null, focusVersion: 0 });
