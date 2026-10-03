import { getSubmission } from "@/io/storage";
import type { PreviewPin, PreviewPinReference } from "@/model/preview";
import { immutableCopy } from "@/model/version";

export function pinReference(pin: PreviewPin): PreviewPinReference {
  const { bundle: _, ...source } = pin.source;
  return immutableCopy({ source, lane: pin.lane });
}

export async function restorePin(reference: PreviewPinReference, signal: AbortSignal): Promise<PreviewPin> {
  signal.throwIfAborted();
  const { source, lane } = reference;
  if (source.identity.kind !== "run") throw new Error("Preview snapshot has no saved run reference.");
  const run = source.identity.run;
  const submission = await getSubmission(run.submissionKey);
  signal.throwIfAborted();
  if (submission === undefined || submission.key !== run.submissionKey || submission.address !== run.address
    || submission.boot !== run.boot || submission.run !== run.sequence || submission.source.buildId !== run.buildId
    || submission.source.engineIdentity !== run.engineIdentity || submission.digest !== run.digest || source.digest !== run.digest) {
    throw new Error("Saved run no longer matches this pinned preview.");
  }
  return { source: Object.freeze({ ...source, bundle: submission.bundle }), lane };
}
