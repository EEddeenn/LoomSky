import { baseOf } from "./wire";
import type { CommandLine, OperationId, RunId } from "@/model/host";

export type Reply = { code: number; body: string };

function escapeAscii(json: string): string {
  return json.replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export function submit(
  address: string,
  token: string,
  bundle: Uint8Array<ArrayBuffer>,
  request: { operation: OperationId; config: { gain_db: number; replay_ms?: number; label: string } },
  progress: (share: number) => void,
  signal: AbortSignal,
): Promise<Reply> {
  return new Promise<Reply>((resolve, reject) => {
    let abort = () => {};
    const finish = (reply: Reply) => {
      signal.removeEventListener("abort", abort);
      resolve(reply);
    };
    try {
      const xhr = new XMLHttpRequest();
      abort = () => xhr.abort();
      xhr.open("POST", `${baseOf(address)}/run`);
      xhr.setRequestHeader("authorization", `Bearer ${token}`);
      xhr.setRequestHeader("loomsky-config", escapeAscii(JSON.stringify(request)));
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) progress(e.loaded / e.total);
      };
      xhr.onload = () => finish({ code: xhr.status, body: xhr.responseText });
      xhr.onerror = () => finish({ code: 0, body: "" });
      xhr.onabort = () => finish({ code: -1, body: "" });
      signal.addEventListener("abort", abort, { once: true });
      signal.throwIfAborted();
      xhr.send(new Blob([bundle]));
    } catch (error) {
      signal.removeEventListener("abort", abort);
      reject(error);
    }
  });
}

export function postCommand(address: string, token: string, target: RunId, actionId: string, command: CommandLine, signal: AbortSignal): Promise<Reply> {
  return post(address, token, "/command", { target, actionId, command }, signal);
}

export function stopRun(address: string, token: string, target: RunId, signal: AbortSignal): Promise<Reply> {
  return post(address, token, "/stop", { target }, signal);
}

export function cancelOperation(address: string, token: string, operation: OperationId, signal: AbortSignal): Promise<Reply> {
  return post(address, token, "/cancel", { operation }, signal);
}

async function post(address: string, token: string, path: "/stop" | "/command" | "/cancel", request: unknown, signal: AbortSignal): Promise<Reply> {
  try {
    const response = await fetch(`${baseOf(address)}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(request), signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]) });
    return { code: response.status, body: await response.text() };
  } catch {
    return { code: signal.aborted ? -1 : 0, body: "" };
  }
}

export function refusal(reply: Reply): string {
  try {
    const value: unknown = JSON.parse(reply.body);
    if (typeof value === "object" && value !== null && "error" in value && typeof value.error === "string") return value.error;
  } catch {
    return reply.code === 0 ? "no answer" : `HTTP ${reply.code}`;
  }
  return `HTTP ${reply.code}`;
}
