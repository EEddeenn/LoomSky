"use client";

import { useTruthExport } from "@/workbench/outputs";
import type { TruthExportInput } from "@/workbench/operations";
import { Icon, Spinner } from "@/page/shared/ui";

export function TruthButtons({ id, outputs, request, onStart, disabled = false }: { id: string; outputs: { observation: boolean; position: string | null }; request: TruthExportInput | null; onStart?: (format: 0 | 1) => void; disabled?: boolean }) {
  const output = useTruthExport(request);
  const files: { label: string; kind: 0 | 1 }[] = [];
  if (outputs.observation) files.push({ label: `${id}.obs`, kind: 0 });
  if (outputs.position !== null) files.push({ label: `${id}.${outputs.position}`, kind: 1 });
  return (
    <div className="flex flex-wrap gap-2">
      {files.map((f) => {
        const job = output.job(f.kind);
        return job === undefined ? (
          <button
            key={f.kind}
            type="button"
            disabled={disabled || !output.available}
            onClick={() => onStart === undefined ? void output.start(f.kind) : onStart(f.kind)}
            className="inline-flex h-7 min-w-0 max-w-full items-center gap-2 rounded-key bg-face px-2.5 font-medium ring-key enabled:hover:bg-hover disabled:opacity-45"
          >
            <Icon name="download" size={14} />
            <span className="min-w-0 truncate" title={f.label}>{f.label}</span>
          </button>
        ) : (
          <span key={f.kind} title={job.name} className="inline-flex h-7 items-center gap-2 rounded-key bg-face pl-2.5 ring-key">
            <Spinner />
            <span className="fn">{job.cancellationRequested ? "Stopping…" : job.progress === null ? "Preparing…" : `${Math.floor(job.progress * 100)} %`}</span>
            <button type="button" disabled={!job.cancellable} onClick={() => output.cancel(f.kind)} className="h-7 rounded-r-key px-2.5 font-medium shadow-[inset_1px_0_0_var(--line2)] enabled:hover:bg-hover disabled:opacity-45">
              {job.phase === "committing" ? "Finishing…" : "Cancel"}
            </button>
          </span>
        );
      })}
    </div>
  );
}
