export type PlotSample = { time: number; value: number };
export type PlotBounds = { duration: number; low: number; high: number };

export const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
export const timeX = (time: number, duration: number) => 1 + clamp(time / duration, 0, 1) * 98;
export const valueY = (value: number, bounds: PlotBounds) => 94 - ((value - bounds.low) / (bounds.high - bounds.low)) * 88;

export function plotBounds(duration: number, values: readonly number[], nonnegative: boolean): PlotBounds {
  let low = nonnegative ? 0 : Infinity;
  let high = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  if (!Number.isFinite(low)) low = 0;
  if (!Number.isFinite(high)) high = low + 1;
  const padding = Math.max(0.1, (high - low) * 0.12);
  return { duration: Math.max(0.1, duration), low: nonnegative ? Math.min(0, low) : low - padding, high: high + padding };
}

export function sampleAt(samples: readonly PlotSample[], time: number): number | null {
  const beginning = samples[0];
  const ending = samples[samples.length - 1];
  if (beginning === undefined || ending === undefined || time < beginning.time || time > ending.time) return null;
  let low = 0;
  let high = samples.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    const sample = samples[middle];
    if (sample !== undefined && sample.time <= time) low = middle;
    else high = middle;
  }
  const first = samples[low];
  const last = samples[high];
  if (first === undefined || last === undefined) return null;
  const fraction = clamp((time - first.time) / (last.time - first.time || 1), 0, 1);
  const value = first.value + (last.value - first.value) * fraction;
  return Number.isFinite(value) ? value : null;
}

export function plotPath(samples: readonly PlotSample[], bounds: PlotBounds): string {
  const stride = Math.max(1, Math.ceil(samples.length / 800));
  const points: PlotSample[] = [];
  for (let index = 0; index < samples.length; index += stride) {
    const group = samples.slice(index, index + stride);
    const first = group[0];
    const last = group[group.length - 1];
    if (first === undefined || last === undefined) continue;
    let minimum = first;
    let maximum = first;
    for (const sample of group) {
      if (sample.value < minimum.value) minimum = sample;
      if (sample.value > maximum.value) maximum = sample;
    }
    const extremes = minimum.time <= maximum.time ? [minimum, maximum] : [maximum, minimum];
    points.push(first, ...extremes, last);
  }
  let connected = false;
  return points.map((sample) => {
    if (!Number.isFinite(sample.time) || !Number.isFinite(sample.value)) {
      connected = false;
      return "";
    }
    const command = `${connected ? "L" : "M"}${(timeX(sample.time, bounds.duration) * 10).toFixed(2)} ${valueY(sample.value, bounds).toFixed(2)}`;
    connected = true;
    return command;
  }).join(" ");
}
