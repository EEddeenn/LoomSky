import { Zip, ZipDeflate } from "fflate";
import type { NamedBytes } from "@/io/pharos";
import type { ByteSink } from "../protocol";

const chunkBytes = 256 * 1024;

export async function zip(entries: AsyncIterable<NamedBytes>, sink: ByteSink, signal: AbortSignal): Promise<number> {
  signal.throwIfAborted();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytesWritten = 0;
  const archive = new Zip((error, data) => {
    if (error !== null) throw error;
    chunks.push(new Uint8Array(data));
  });
  const flush = async () => {
    for (const chunk of chunks) {
      signal.throwIfAborted();
      bytesWritten += chunk.byteLength;
      await sink.write(chunk);
    }
    chunks.length = 0;
  };
  try {
    let sliceStarted = performance.now();
    for await (const { name, bytes } of entries) {
      signal.throwIfAborted();
      const file = new ZipDeflate(name);
      archive.add(file);
      if (bytes.length === 0) file.push(bytes, true);
      for (let at = 0; at < bytes.length; at += chunkBytes) {
        signal.throwIfAborted();
        file.push(bytes.subarray(at, at + chunkBytes), at + chunkBytes >= bytes.length);
        await flush();
        if (performance.now() - sliceStarted >= 24) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          sliceStarted = performance.now();
        }
      }
      await flush();
    }
    signal.throwIfAborted();
    archive.end();
    await flush();
    signal.throwIfAborted();
    return bytesWritten;
  } finally {
    archive.terminate();
  }
}
