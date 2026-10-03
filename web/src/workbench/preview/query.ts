import { useCallback, useLayoutEffect, useRef, useState } from "react";

type Reading<T> = { scope: string; epochMs: number; value: T };
type Failure = { scope: string; epochMs: number; message: string };

export function useLatestQuery<T>(scope: string | null, epochMs: number, load: (signal: AbortSignal) => Promise<T>) {
  const latest = useRef({ scope, epochMs, load });
  const request = useRef<((retry?: boolean) => Promise<void>) | null>(null);
  const [reading, setReading] = useState<Reading<T> | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  useLayoutEffect(() => { latest.current = { scope, epochMs, load }; });
  useLayoutEffect(() => {
    if (scope === null) return;
    const abort = new AbortController();
    let pending: Promise<void> | null = null;
    let completed: number | null = null;
    const run = (retry = false): Promise<void> => {
      if (pending !== null) return pending;
      const next = latest.current;
      if (abort.signal.aborted || next.scope !== scope || !retry && completed === next.epochMs) return Promise.resolve();
      completed = next.epochMs;
      if (retry) setFailure(null);
      pending = Promise.resolve().then(() => next.load(abort.signal)).then(
        (value) => {
          if (abort.signal.aborted) return;
          setReading({ scope, epochMs: next.epochMs, value });
          setFailure(null);
        },
        (error: unknown) => {
          if (!abort.signal.aborted) setFailure({ scope, epochMs: next.epochMs, message: error instanceof Error ? error.message : String(error) });
        },
      ).finally(() => {
        pending = null;
        void run();
      });
      return pending;
    };
    request.current = run;
    void run();
    return () => {
      if (request.current === run) request.current = null;
      abort.abort();
    };
  }, [scope]);
  useLayoutEffect(() => { void request.current?.(); });

  const retry = useCallback(async () => { await request.current?.(true); }, []);
  const error = scope !== null && failure?.scope === scope && failure.epochMs === epochMs ? failure.message : null;
  const current = scope !== null && error === null && reading?.scope === scope ? reading : null;
  return { reading: current, error, retry, pending: scope !== null && (current === null || current.epochMs !== epochMs) };
}
