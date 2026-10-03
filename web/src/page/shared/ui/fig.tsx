import { Fragment, type ReactNode } from "react";

const figure = /(^|[^\w°.:–\-/&#])([+−]?\d(?:[\d .,:–-]*\d)?)/g;

export function Fig({ children }: { children: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of children.matchAll(figure)) {
    const number = match[2] ?? "";
    const start = match.index + (match[1] ?? "").length;
    if (start > last) parts.push(<Fragment key={`t${start}`}>{children.slice(last, start)}</Fragment>);
    parts.push(
      <span key={start} className="fn">
        {number}
      </span>,
    );
    last = start + number.length;
  }
  if (last < children.length) parts.push(<Fragment key="end">{children.slice(last)}</Fragment>);
  return <span>{parts}</span>;
}
