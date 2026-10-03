type Stretch = { fromGpsMs: number; untilGpsMs: number };
type CoverageInterval = Stretch & { system: string };
export type CoverageWindow = { stretches: Stretch[]; fits: boolean; moveTo: number | null };

function union(stretches: Stretch[]): Stretch[] {
  const merged: Stretch[] = [];
  for (const stretch of stretches.toSorted((a, b) => a.fromGpsMs - b.fromGpsMs)) {
    const previous = merged.at(-1);
    if (previous === undefined || stretch.fromGpsMs > previous.untilGpsMs) merged.push({ ...stretch });
    else previous.untilGpsMs = Math.max(previous.untilGpsMs, stretch.untilGpsMs);
  }
  return merged;
}

function intersect(left: Stretch[], right: Stretch[]): Stretch[] {
  const common: Stretch[] = [];
  for (const a of left) {
    for (const b of right) {
      const fromGpsMs = Math.max(a.fromGpsMs, b.fromGpsMs);
      const untilGpsMs = Math.min(a.untilGpsMs, b.untilGpsMs);
      if (fromGpsMs < untilGpsMs) common.push({ fromGpsMs, untilGpsMs });
    }
  }
  return common;
}

export function coverageWindow(coverage: readonly CoverageInterval[], needed: readonly string[], window: { startGpsMs: number; durationMs: number }): CoverageWindow {
  const systems = new Set(needed.length === 0 ? coverage.map((c) => c.system) : needed);
  let common: Stretch[] | null = null;
  for (const system of systems) {
    const own = union(coverage.filter((c) => c.system === system).map(({ fromGpsMs, untilGpsMs }) => ({ fromGpsMs, untilGpsMs })));
    common = common === null ? own : intersect(common, own);
  }
  const stretches = common ?? [];
  let moveTo: number | null = null;
  for (const stretch of stretches) {
    if (stretch.untilGpsMs - stretch.fromGpsMs < window.durationMs) continue;
    const start = Math.max(stretch.fromGpsMs, Math.min(window.startGpsMs, stretch.untilGpsMs - window.durationMs));
    if (moveTo === null || Math.abs(start - window.startGpsMs) < Math.abs(moveTo - window.startGpsMs)) moveTo = start;
  }
  return { stretches, fits: moveTo === window.startGpsMs, moveTo };
}
