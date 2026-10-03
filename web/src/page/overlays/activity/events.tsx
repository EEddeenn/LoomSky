"use client";

import { gpsClock, presentLeap, utcClock } from "@/model/gnss";
import { useStore } from "@/core";
import { clearLog, downloadLog, events, feedback, openProblems, type EventKind } from "@/workbench/feedback";
import { Button, Fig, Icon, type IconName } from "@/page/shared/ui";

const glyphs: Record<EventKind, [IconName, string]> = {
  alarm: ["alert", "text-fault"],
  warn: ["warn", "text-warn-ink"],
  unknown: ["unknown", "text-rf-ink"],
  action: ["send", "text-ink"],
  onair: ["on", "text-rf-mark"],
  notice: ["info", "text-ink3"],
  success: ["done", "text-ink2"],
};

function Text({ text }: { text: string }) {
  return (
    <>
      {text.split(/`([^`]+)`/).map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className="text-small">
            {part}
          </code>
        ) : (
          <Fig key={i}>{part}</Fig>
        ),
      )}
    </>
  );
}

export function Events() {
  const problems = useStore(feedback, (s) => s.problems);
  const log = useStore(events, (s) => s.log);
  return (
    <>
      <div className="flex flex-none items-center justify-end gap-2 border-b border-line2 py-2 pr-3 pl-4">
        <Button size="sm" icon="download" onClick={downloadLog}>
          Download log
        </Button>
        <Button size="sm" icon="trash" disabled={log.length === 0} onClick={clearLog}>
          Clear log
        </Button>
      </div>
      <ul className="m-0 min-h-0 flex-auto list-none overflow-auto p-0">
        {log.length === 0 ? <li className="px-4 py-5 text-small text-ink3">No events yet</li> : null}
        {log.map((e, i) => {
          const [glyph, tone] = glyphs[e.kind];
          return (
            <li key={e.id} className={`grid grid-cols-[16px_minmax(0,1fr)] gap-x-3 px-4 py-2 leading-5 ${i > 0 ? "border-t border-line" : ""}`}>
              <span className={`mt-[3px] ${tone}`}>
                <Icon name={glyph} size={14} />
              </span>
              <span>
                {e.host !== "" ? <b className="font-semibold">{e.host} </b> : null}
                <Text text={e.text.startsWith(`${e.host} `) ? e.text.slice(e.host.length + 1) : e.text} />
              </span>
              {e.problemId !== undefined && problems.some((problem) => problem.id === e.problemId) ? <Button size="xs" variant="ghost" className="col-start-2 justify-self-start" onClick={() => openProblems(e.problemId)}>View problem</Button> : null}
              <span className="fn col-start-2 text-small text-ink3">{`${gpsClock(e.gps)} GPS · ${utcClock(e.gps, presentLeap)} UTC`}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
