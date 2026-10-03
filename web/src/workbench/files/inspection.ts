import { useEffect, useState } from "react";
import { reserveInput } from "@/io/input";
import { compute } from "@/io/compute";
import type { Coverage } from "@/io/pharos";
import { fileBytes } from "@/io/storage";
import type { LibraryFileRecord } from "@/model/library";

type FilePreview = {
  text: string | null;
  truncated: boolean;
  coverage: readonly Coverage[] | null;
  coverageError: string | null;
};
type Reading = { key: string } & ({ status: "ready"; preview: FilePreview } | { status: "error"; message: string });

function snippet(bytes: Uint8Array): { text: string | null; truncated: boolean } {
  const head = bytes.subarray(0, 8192);
  if (head.some((byte) => byte < 9 || byte > 13 && byte < 32 || byte === 127)) return { text: null, truncated: false };
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(head, { stream: head.length < bytes.length });
    const lines = text.split(/\r?\n/);
    const shown = lines.slice(0, 60).join("\n").slice(0, 6000);
    return { text: shown, truncated: head.length < bytes.length || shown.length < text.length };
  } catch {
    return { text: null, truncated: false };
  }
}

async function readPreview(file: LibraryFileRecord, signal: AbortSignal): Promise<FilePreview> {
  const release = reserveInput(file.size, signal);
  try {
    const bytes = await fileBytes(file.digest);
    signal.throwIfAborted();
    if (bytes === null) throw new Error("File unavailable in browser storage.");
    const text = snippet(bytes);
    if (file.kind !== "ephemeris") return { ...text, coverage: null, coverageError: null };
    try {
      const coverage = await compute.pack.describe({ name: file.name, digest: file.digest, bytes }, { priority: "interactive", signal });
      return { ...text, coverage, coverageError: null };
    } catch (error) {
      signal.throwIfAborted();
      return { ...text, coverage: null, coverageError: error instanceof Error ? error.message : String(error) };
    }
  } finally { release(); }
}

export function useFilePreview(file: LibraryFileRecord) {
  const [reading, setReading] = useState<Reading | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([file.id, file.kind, file.name, file.digest]);
  useEffect(() => {
    const controller = new AbortController();
    void readPreview(file, controller.signal).then(
      (preview) => { if (!controller.signal.aborted) setReading({ key, status: "ready", preview }); },
      (error: unknown) => { if (!controller.signal.aborted) setReading({ key, status: "error", message: error instanceof Error ? error.message : String(error) }); },
    );
    return () => controller.abort();
  }, [key, attempt]);
  return {
    reading: reading?.key === key ? reading : null,
    retry: () => {
      setReading(null);
      setAttempt((value) => value + 1);
    },
  };
}
