import { createStore } from "@/core";
import { readSchemas } from "@/io/pharos";
import type { Schema } from "@/model/schema";

type Schemas =
  | { status: "loading"; scenario: null; trajectory: null; error: string | null }
  | { status: "error"; scenario: null; trajectory: null; error: string }
  | { status: "ready"; scenario: Schema; trajectory: Schema; error: null };

export const schemas = createStore<Schemas>({ status: "loading", scenario: null, trajectory: null, error: null });

let loading: Promise<void> | null = null;

export function loadSchemas(): Promise<void> {
  if (loading !== null) return loading;
  if (schemas.get().status === "ready") return Promise.resolve();
  schemas.set({ status: "loading", scenario: null, trajectory: null, error: schemas.get().error });

  loading = readSchemas()
    .then(
      (loaded) => schemas.set({ status: "ready", ...loaded, error: null }),
      (error: unknown) => schemas.set({ status: "error", scenario: null, trajectory: null, error: error instanceof Error ? error.message : String(error) }),
    )
    .finally(() => { loading = null; });
  return loading;
}
