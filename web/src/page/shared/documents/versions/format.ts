export function versionLabel(number: number): string { return `v${number}`; }

export function savedTime(time: number, short = false): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", ...(short ? {} : { year: "numeric" }),
  }).format(time);
}
