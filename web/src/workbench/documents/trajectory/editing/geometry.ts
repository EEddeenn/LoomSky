import { useEffect, useId, useMemo, useState } from "react";
import { compute } from "@/io/compute";
import type { GeometryInspection, Plan } from "@/model/trajectory";
import { replaceProblems, type Problem } from "@/workbench/feedback";

type Reading = { input: string; geometry: GeometryInspection; message: null } | { input: string; geometry: null; message: string };

export function useGeometryPreview(resourceId: string, plan: Plan | null, visible: boolean): GeometryInspection | null {
  const owner = useId();
  const input = !visible || plan === null ? null : JSON.stringify({ coordinates: plan.coordinates, geometry: plan.geometry });
  const [reading, setReading] = useState<Reading | null>(null);
  useEffect(() => {
    if (input === null) return;
    const abort = new AbortController();
    compute.traj.geometry(input, { priority: "interactive", signal: abort.signal }).then(
      (geometry) => { if (!abort.signal.aborted) setReading({ input, geometry, message: null }); },
      (error: unknown) => {
        if (abort.signal.aborted || error instanceof DOMException && error.name === "AbortError") return;
        setReading({ input, geometry: null, message: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => abort.abort();
  }, [input, resourceId]);
  const current = reading?.input === input ? reading : null;
  const message = current?.message ?? null;
  const problem = useMemo<Problem | null>(() => message === null ? null : {
    id: `geometry:${resourceId}`, level: "error", scope: `Trajectory · ${resourceId}`,
    title: "Geometry preview unavailable", message,
  }, [message, resourceId]);
  useEffect(() => { replaceProblems(owner, problem === null ? [] : [problem]); }, [owner, problem]);
  useEffect(() => () => replaceProblems(owner, []), [owner]);
  return current?.geometry ?? null;
}
