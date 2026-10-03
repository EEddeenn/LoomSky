import { gpsClock } from "@/model/gnss";
import { airsUntil } from "./control";
import { hostOf, nameOf } from "../state";
import { removeRegisteredHost } from "../connection";
import { log, requestConfirmation, toast } from "@/workbench/feedback";
import { resourceRemoved } from "@/workbench/navigation";
import { startExport } from "@/workbench/operations";
import type { SubmissionRecord } from "@/model/host";

export function removeHost(key: string): void {
  const h = hostOf(key);
  if (h === undefined) return;
  const registrationId = h.record.id;
  const until = airsUntil(h, Date.now());
  requestConfirmation({
    id: `host:${key}:remove`, scope: nameOf(h), title: "Remove transmitter?",
    message: "Remove from this browser? Saved runs remain. Active RF continues until its scheduled end or a Stop.",
    details: [
      { label: "Address", value: h.record.address },
      { label: "Transmission", value: until === null ? "No active run reported" : `Run ${until.run} · until ${gpsClock(until.endGps)} GPS or a Stop` },
    ],
    confirmLabel: "Remove transmitter",
    confirm: async () => {
      await removeRegisteredHost(key, registrationId);
      const until = airsUntil(h, Date.now());
      const tail = until === null ? "" : `. Run ${until.run} continues until ${gpsClock(until.endGps)} GPS or a Stop.`;
      toast(`Removed ${nameOf(h)}${tail}`, until === null ? "success" : "warning");
      log(nameOf(h), `Remove host${tail}`, "action");
      resourceRemoved({ kind: "host", key }, registrationId);
    },
  });
}

export async function downloadSubmissionAsset(submission: SubmissionRecord, name: string, digest: string): Promise<void> {
  await startExport({
    kind: "file", resource: { kind: "host", key: submission.address }, digest,
    name: name.split(/[\\/]/).at(-1) || "submission",
  }).done;
}
