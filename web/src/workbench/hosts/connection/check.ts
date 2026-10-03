import { ask, baseOf, type Answer } from "@/io/hosts";
import type { Snapshot } from "@/model/host";

type CheckedHost = { address: string; token: string; snapshot: Snapshot };
export type HostCheck = { kind: "ready"; host: CheckedHost } | { kind: "failed"; address: string; message: string };

function failureMessage(answer: Exclude<Answer, { kind: "status" }>, address: string, origin: string): string {
  switch (answer.kind) {
    case "token":
      return "Token refused (401).";
    case "origin":
      return `Origin ${origin} is not allowed. Add it to host origins, then restart LoomSky.`;
    case "http":
      return `Host returned ${answer.code} without status.`;
    case "noanswer":
      return `No answer from ${address} in 2 s.`;
  }
}

export async function checkHost(address: string, token: string, origin: string): Promise<HostCheck> {
  const credentials = { address: address.trim(), token: token.trim() };
  const answer = await ask({ base: baseOf(credentials.address), token: credentials.token }, 2000);
  return answer.kind === "status"
    ? { kind: "ready", host: { ...credentials, snapshot: answer.snapshot } }
    : { kind: "failed", address: credentials.address, message: failureMessage(answer, credentials.address, origin) };
}
