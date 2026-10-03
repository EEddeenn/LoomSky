import { sha256 } from "@/core";
import { compilePharos, instantiatePharos, PharosError, type CompiledPharos, type Pack, type PharosProduct, type Traj } from "@/io/pharos";
import type { Answer, Bundle, ByteSink, Call, ModuleInput, Request } from "./protocol";
import { zip } from "./worker/archive";
import { ObsWorker } from "./worker/obs";

type Reply = Extract<Request, { kind: "source" | "written" }>;
type Active = { id: number; stop: AbortController; reply: ((request: Reply) => void) | null };

const compiled = new Map<PharosProduct, CompiledPharos>();
let traj: Traj | null = null;
let pack: Pack | null = null;
let obs: ObsWorker | null = null;
let active: Active | null = null;

function send(answer: Answer, transfer: Transferable[] = []): void {
  if (answer.kind === "result" || answer.kind === "cancelled") {
    const resources = obs?.resources() ?? { memoryBytes: 0, sources: [] };
    resources.memoryBytes += (traj?.memoryBytes ?? 0) + (pack?.memoryBytes ?? 0);
    postMessage({ kind: "resources", id: answer.id, resources } satisfies Answer);
  }
  postMessage(answer, { transfer });
}

function waitFor<K extends Reply["kind"]>(owner: Active, kind: K, message: Answer, transfer: Transferable[] = []): Promise<Extract<Reply, { kind: K }>> {
  const { signal } = owner.stop;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { owner.reply = null; reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    owner.reply = (request) => {
      if (request.kind !== kind) return;
      signal.removeEventListener("abort", abort);
      owner.reply = null;
      resolve(request as Extract<Reply, { kind: K }>);
    };
    send(message, transfer);
  });
}

function output(owner: Active): ByteSink {
  return {
    async write(bytes) {
      await waitFor(owner, "written", { kind: "chunk", id: owner.id, bytes }, [bytes.buffer]);
    },
  };
}

async function module(input: ModuleInput, id: number, signal: AbortSignal): Promise<CompiledPharos> {
  const cached = compiled.get(input.product);
  if (cached !== undefined) return cached;
  const loaded = input.compiled ?? await compilePharos(input.url, signal);
  signal.throwIfAborted();
  compiled.set(input.product, loaded);
  if (input.compiled === null) send({ kind: "module", id, product: input.product, compiled: loaded });
  return loaded;
}

async function source(owner: Active, digest: string): Promise<Bundle> {
  return (await waitFor(owner, "source", { kind: "source", id: owner.id, digest })).bytes;
}

function unload(product: PharosProduct | null): void {
  switch (product) {
    case "traj": traj = null; return;
    case "pack": pack = null; return;
    case "obs": obs?.dispose(); obs = null; return;
    case null: return;
  }
}

async function run(call: Call, input: ModuleInput | null, owner: Active): Promise<void> {
  const { signal } = owner.stop;
  let identity: string | null = null;
  try {
    const loaded = input === null ? null : await module(input, call.id, signal);
    identity = loaded?.identity ?? null;
    signal.throwIfAborted();
    const binary = loaded?.module;
    switch (call.op) {
      case "identity":
        send({ kind: "result", op: call.op, id: call.id, ok: true, value: identity! });
        return;
      case "solve": {
        traj ??= instantiatePharos("traj", binary!);
        const track = traj.buildTrajectory(call.args.text);
        send({ kind: "result", op: call.op, id: call.id, ok: true, value: { engineIdentity: identity!, value: track } }, [track.states.buffer, ...(track.pht === null ? [] : [track.pht.buffer])]);
        return;
      }
      case "geometry":
        traj ??= instantiatePharos("traj", binary!);
        send({ kind: "result", op: call.op, id: call.id, ok: true, value: traj.geometry(call.args.text) });
        return;
      case "pack": {
        pack ??= instantiatePharos("pack", binary!);
        const value = pack.pack(call.args.scenario, call.args.files);
        send({ kind: "result", op: call.op, id: call.id, ok: true, value: { engineIdentity: identity!, value } }, value.bundle === null ? [] : [value.bundle.buffer]);
        return;
      }
      case "describe":
        pack ??= instantiatePharos("pack", binary!);
        send({ kind: "result", op: call.op, id: call.id, ok: true, value: pack.describe(call.args.file) });
        return;
      case "truth":
      case "inspect":
      case "lane":
      case "file": {
        obs ??= new ObsWorker(instantiatePharos("obs", binary!));
        if (!obs.has(call.args.digest)) obs.keep(call.args.digest, await source(owner, call.args.digest));
        signal.throwIfAborted();
        switch (call.op) {
          case "truth":
            send({ kind: "result", op: call.op, id: call.id, ok: true, value: obs.truth(call.args) });
            return;
          case "inspect":
            send({ kind: "result", op: call.op, id: call.id, ok: true, value: obs.inspect(call.args) });
            return;
          case "lane": {
            const value = await obs.lane(call.args, signal);
            signal.throwIfAborted();
            send({ kind: "result", op: call.op, id: call.id, ok: true, value });
            return;
          }
          case "file": {
            const value = await obs.file(call.args, output(owner), signal, (share) => send({ kind: "progress", id: call.id, share }));
            signal.throwIfAborted();
            send({ kind: "result", op: call.op, id: call.id, ok: true, value });
            return;
          }
        }
      }
      case "hash":
        send({ kind: "result", op: call.op, id: call.id, ok: true, value: sha256(call.args.bytes) });
        return;
      case "zip": {
        const names = call.args.names;
        async function* entries() {
          for (const [index, name] of names.entries()) yield { name, bytes: await source(owner, String(index)) };
        }
        const value = await zip(entries(), output(owner), signal);
        signal.throwIfAborted();
        send({ kind: "result", op: call.op, id: call.id, ok: true, value });
        return;
      }
    }
  } catch (error) {
    if (signal.aborted) send({ kind: "cancelled", id: call.id });
    else {
      if (!(error instanceof PharosError)) unload(input?.product ?? null);
      send({ kind: "result", id: call.id, ok: false, error: error instanceof Error ? error.message : String(error), engineIdentity: identity });
    }
  } finally {
    active = null;
  }
}

addEventListener("message", (event: MessageEvent<Request>) => {
  const request = event.data;
  switch (request.kind) {
    case "cancel":
      if (active?.id === request.id) active.stop.abort();
      return;
    case "source":
    case "written":
      if (active?.id === request.id) active.reply?.(request);
      return;
    case "call": {
      if (active !== null) throw new Error("A compute worker received overlapping tasks.");
      const owner: Active = { id: request.call.id, stop: new AbortController(), reply: null };
      active = owner;
      void run(request.call, request.module, owner);
    }
  }
});
