import { displayOrder, gpsClock, gpsDate } from "@/model/gnss";
import type { Coverage } from "@/io/pharos";
import { PreviewSection } from "../info";

function time(value: number): string {
  return `${gpsDate(value)} ${gpsClock(value)} GPS`;
}

export function CoveragePreview({ coverage }: { coverage: readonly Coverage[] }) {
  const intervals = coverage.filter((item) => Number.isFinite(item.fromGpsMs) && Number.isFinite(item.untilGpsMs) && item.untilGpsMs > item.fromGpsMs);
  if (intervals.length === 0) return <PreviewSection title="Navigation coverage"><p className="m-0 text-small text-ink3">No usable navigation coverage.</p></PreviewSection>;
  const start = Math.min(...intervals.map((item) => item.fromGpsMs));
  const end = Math.max(...intervals.map((item) => item.untilGpsMs));
  const systems = displayOrder.filter((system) => intervals.some((item) => item.system === system));
  return <PreviewSection title="Navigation coverage">
    <div className="flex flex-col gap-3">
      {systems.map((system) => {
        const ranges = intervals.filter((item) => item.system === system);
        const satellites = [...new Set(ranges.flatMap((item) => item.satellites))].sort((a, b) => a - b);
        return <div key={system} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-small">
            <span>{system}</span>
            <span className="text-ink3">{satellites.length} satellites</span>
          </div>
          <div role="img" aria-label={`${system} coverage: ${ranges.map((range) => `${time(range.fromGpsMs)} to ${time(range.untilGpsMs)}`).join("; ")}`} className="relative h-2 overflow-hidden rounded-key bg-line">
            {ranges.map((range, index) => (
              <span key={index} className="absolute inset-y-0 min-w-px rounded-key bg-ink3" style={{
                left: `${(range.fromGpsMs - start) / (end - start) * 100}%`,
                width: `${(range.untilGpsMs - range.fromGpsMs) / (end - start) * 100}%`,
              }} />
            ))}
          </div>
          <p className="m-0 text-micro text-ink3 [overflow-wrap:anywhere]">PRNs {satellites.join(", ")}</p>
        </div>;
      })}
    </div>
    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-small text-ink3">
      <dt>From</dt><dd className="m-0 text-right">{time(start)}</dd>
      <dt>Until</dt><dd className="m-0 text-right">{time(end)}</dd>
    </dl>
  </PreviewSection>;
}
