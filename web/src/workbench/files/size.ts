import { fileByteLength } from "@/io/storage";
import { fileLibrary } from "./state";

export function readFileSize(digest: string): Promise<number | null> {
  const known = [...fileLibrary.get().items.values()].find((file) => file.digest === digest);
  return known === undefined ? fileByteLength(digest) : Promise.resolve(known.size);
}
