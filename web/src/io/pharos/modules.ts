import { sha256 } from "@/core";
import { Traj } from "./traj";
import { Pack } from "./pack";
import { Obs } from "./obs";

export type PharosProduct = "traj" | "pack" | "obs";
export type CompiledPharos = { module: WebAssembly.Module; identity: string };

export async function compilePharos(url: string, signal?: AbortSignal): Promise<CompiledPharos> {
  signal?.throwIfAborted();
  const response = await fetch(url, { signal });
  signal?.throwIfAborted();
  if (!response.ok) throw new Error(`Could not load Pharos (${response.status})`);
  const bytes = await response.arrayBuffer();
  signal?.throwIfAborted();
  const identity = sha256(new Uint8Array(bytes));
  signal?.throwIfAborted();
  const module = await WebAssembly.compile(bytes);
  signal?.throwIfAborted();
  return { module, identity };
}

export function instantiatePharos(product: "traj", module: WebAssembly.Module): Traj;
export function instantiatePharos(product: "pack", module: WebAssembly.Module): Pack;
export function instantiatePharos(product: "obs", module: WebAssembly.Module): Obs;
export function instantiatePharos(product: PharosProduct, module: WebAssembly.Module): Traj | Pack | Obs;
export function instantiatePharos(product: PharosProduct, module: WebAssembly.Module): Traj | Pack | Obs {
  const instance = new WebAssembly.Instance(module, {});
  switch (product) {
    case "traj": return new Traj(instance);
    case "pack": return new Pack(instance);
    case "obs": return new Obs(instance);
  }
}
