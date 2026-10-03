type SourceLine = { kind: "same" | "removed" | "added"; text: string; before?: number; after?: number };

export function sourceDiff(before: string, after: string): SourceLine[] {
  const left = before.split("\n");
  const right = after.split("\n");
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start++;
  let end = 0;
  while (end < left.length - start && end < right.length - start && left[left.length - 1 - end] === right[right.length - 1 - end]) end++;
  const rows: SourceLine[] = left.slice(0, start).map((text, i) => ({ kind: "same", text, before: i + 1, after: i + 1 }));
  const a = left.slice(start, left.length - end);
  const b = right.slice(start, right.length - end);
  if (a.length * b.length <= 250_000) {
    const columns = b.length + 1;
    const scores = new Uint32Array((a.length + 1) * columns);
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) scores[i * columns + j] = a[i] === b[j]
        ? 1 + scores[(i + 1) * columns + j + 1]!
        : Math.max(scores[(i + 1) * columns + j]!, scores[i * columns + j + 1]!);
    }
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        rows.push({ kind: "same", text: a[i]!, before: start + i++ + 1, after: start + j++ + 1 });
      } else if (i < a.length && (j >= b.length || scores[(i + 1) * columns + j]! >= scores[i * columns + j + 1]!)) {
        rows.push({ kind: "removed", text: a[i]!, before: start + i++ + 1 });
      } else rows.push({ kind: "added", text: b[j]!, after: start + j++ + 1 });
    }
  } else {
    for (const [i, text] of a.entries()) rows.push({ kind: "removed", text, before: start + i + 1 });
    for (const [i, text] of b.entries()) rows.push({ kind: "added", text, after: start + i + 1 });
  }
  for (let i = 0; i < end; i++) rows.push({ kind: "same", text: right[right.length - end + i]!, before: left.length - end + i + 1, after: right.length - end + i + 1 });
  return rows;
}
