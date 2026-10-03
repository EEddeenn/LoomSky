"use client";

import { bytes, useStore } from "@/core";
import type { LibraryFileKind, LibraryFileRecord } from "@/model/library";
import { scenarioCatalog } from "@/workbench/documents/scenario";
import { libraryFileUsage } from "@/workbench/library/relations";
import { fileLibrary, useFilePreview } from "@/workbench/files";
import { Button, FeedbackIcon, Spinner } from "../ui";
import { addedOn, PreviewFacts, PreviewHeader, PreviewList, PreviewSection, PreviewUnavailable } from "./info";
import { CoveragePreview } from "./file/coverage";

const fileKindLabels: Record<LibraryFileKind, string> = { ephemeris: "Navigation ephemeris", almanac: "Almanac", antenna: "Antenna", "precise-orbit": "Precise orbit", "precise-clock": "Precise clock", other: "File" };

function FileFacts({ file }: { file: LibraryFileRecord }) {
  return <PreviewFacts facts={[
    ["Type", fileKindLabels[file.kind]],
    ["Extension", file.extension === "" ? "None" : `.${file.extension}`],
    ["Size", `${bytes(file.size)} · ${file.size.toLocaleString()} bytes`],
    ["Added", addedOn(file.created)],
  ]} />;
}

function FileUsage({ file }: { file: LibraryFileRecord }) {
  useStore(scenarioCatalog, (state) => state.version);
  const uses = libraryFileUsage(file.digest);
  return <PreviewSection title="Used by scenarios">
    <PreviewList items={uses} empty="No scenario references." />
  </PreviewSection>;
}

function FileDigest({ file }: { file: LibraryFileRecord }) {
  return <PreviewSection title="SHA-256"><code className="text-small text-ink3 [overflow-wrap:anywhere]">{file.digest}</code></PreviewSection>;
}

function FileContents({ file, expanded = false }: { file: LibraryFileRecord; expanded?: boolean }) {
  const { reading, retry } = useFilePreview(file);
  if (reading === null) return <div role="status" className="flex items-center gap-2 text-small text-ink3"><Spinner />Reading file…</div>;
  if (reading.status === "error") return <div className="flex flex-col items-start gap-2 text-small text-fault"><span>{reading.message}</span><Button size="xs" onClick={retry}>Retry preview</Button></div>;
  const { text, truncated, coverage, coverageError } = reading.preview;
  return <>
    {coverage === null ? null : <CoveragePreview coverage={coverage} />}
    {coverageError === null ? null : <div className="flex items-start gap-2 text-small text-warn-ink">
      <FeedbackIcon level="warning" />
      <p className="m-0 min-w-0 [overflow-wrap:anywhere]">{`Coverage unavailable: ${coverageError}`}</p>
    </div>}
    <PreviewSection title="Contents">
      {text === null ? <p className="m-0 text-small text-ink3">Text preview unavailable.</p>
        : text === "" ? <p className="m-0 text-small text-ink3">Empty file.</p>
        : <pre className={`m-0 overflow-auto rounded-key border border-line bg-panel p-3 font-mono text-small leading-5 text-ink2 ${expanded ? "min-h-80 max-h-[70vh]" : "max-h-64"}`}>{text}</pre>}
      {truncated ? <p className="m-0 text-small text-ink3">Preview truncated.</p> : null}
    </PreviewSection>
  </>;
}

export function FileDetails({ file, expanded = false }: { file: LibraryFileRecord; expanded?: boolean }) {
  return <div className={expanded ? "grid min-w-0 grid-cols-1 items-start gap-6 p-5 min-[1100px]:grid-cols-[260px_minmax(0,1fr)]" : "flex min-w-0 flex-col gap-5 p-4"}>
    <div className="flex min-w-0 flex-col gap-5">
      <FileFacts file={file} />
      <FileUsage file={file} />
      {expanded ? <FileDigest file={file} /> : null}
    </div>
    <div className="flex min-w-0 flex-col gap-5">
      <FileContents key={`${file.id}:${file.kind}:${file.digest}`} file={file} expanded={expanded} />
      {expanded ? null : <FileDigest file={file} />}
    </div>
  </div>;
}

export function FilePreview({ id }: { id: string }) {
  const file = useStore(fileLibrary, (state) => state.items.get(id));
  if (file === undefined) return <PreviewUnavailable />;
  return <><PreviewHeader title={file.name} kind={fileKindLabels[file.kind]} /><FileDetails file={file} /></>;
}
