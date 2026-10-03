import type { Schema } from "@/model/schema";

async function readSchema(name: string): Promise<Schema> {
  const response = await fetch(new URL(`/${name}`, document.baseURI));
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  return response.json();
}

export async function readSchemas(): Promise<{ scenario: Schema; trajectory: Schema }> {
  const [scenario, trajectory] = await Promise.all([
    readSchema("scenario.schema.json"),
    readSchema("trajectory.schema.json"),
  ]);
  return { scenario, trajectory };
}
