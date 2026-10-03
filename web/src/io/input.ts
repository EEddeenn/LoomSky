import { ResourceLimitError } from "./compute/limits";

const limit = 512 * 1024 * 1024;
const singleLimit = 256 * 1024 * 1024;
let reserved = 0;

export function reserveInput(bytes: number, signal?: AbortSignal): () => void {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Input size unavailable.");
  if (bytes > singleLimit) throw new ResourceLimitError("Inputs exceed 256 MiB. Use smaller or fewer files.");
  if (reserved + bytes > limit) throw new ResourceLimitError("Other inputs are using the memory budget. Wait for a task to finish, then retry.");
  reserved += bytes;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    reserved -= bytes;
  };
}
