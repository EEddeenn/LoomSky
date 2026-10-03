import type { ReactNode } from "react";

const paths = {
  logo: (
    <>
      <path d="M4 18.5a8 8 0 0 1 16 0" />
      <path d="M7.6 18.5a4.4 4.4 0 0 1 8.8 0" />
      <circle cx="12" cy="18.5" r="1.2" fill="currentColor" />
      <path d="M12 3.5v3M5.2 6.3l2 2M18.8 6.3l-2 2" />
    </>
  ),
  stop: <rect x="3" y="3" width="18" height="18" rx="1" fill="currentColor" stroke="none" />,
  on: <circle cx="12" cy="12" r="7" fill="currentColor" stroke="none" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  unknown: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <path d="M4 12 12 4M4 20 20 4M12 20l8-8" strokeLinecap="butt" />
    </>
  ),
  warn: (
    <>
      <path d="M12 2.8 21.2 12 12 21.2 2.8 12z" />
      <path d="M12 8v5" />
      <circle cx="12" cy="16.2" r=".7" fill="currentColor" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 4.4 2.8 17.4A2 2 0 0 0 4.5 20.4h15a2 2 0 0 0 1.7-3L13.7 4.4a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.6v4.2" />
      <circle cx="12" cy="17" r=".7" fill="currentColor" />
    </>
  ),
  idle: <circle cx="12" cy="12" r="5.5" />,
  done: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.2 12.3 2.6 2.6 5-5.2" />
    </>
  ),
  stopped: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  offline: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m6 6 12 12" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="3.5" />
      <path d="m10.5 12.5 8-8M15.5 7.5l2 2M13.5 9.5l1.5 1.5" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  xc: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <circle cx="12" cy="7.9" r=".8" fill="currentColor" />
    </>
  ),
  chev: <path d="m7 10 5 5 5-5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  follow: <path d="M12 3 19 20l-7-3.6L5 20z" />,
  layers: (
    <>
      <path d="m12 4 9 5-9 5-9-5z" />
      <path d="m3 14 9 5 9-5" />
    </>
  ),
  list: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="1" fill="currentColor" />
      <circle cx="4.5" cy="12" r="1" fill="currentColor" />
      <circle cx="4.5" cy="18" r="1" fill="currentColor" />
    </>
  ),
  dots: (
    <>
      <circle cx="5.5" cy="12" r="1.3" fill="currentColor" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.3" fill="currentColor" />
    </>
  ),
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  upload: <path d="M12 16V5M7 10l5-5 5 5M5 20h14" />,
  send: (
    <>
      <path d="M21 3 10.5 13.5" />
      <path d="M21 3 14.5 21l-4-7.5L3 9.5z" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-14.4-4.6L4 8" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 14.4 4.6L20 16" />
      <path d="M20 20v-4h-4" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 16.5h4" />
    </>
  ),
  folder: <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.2h7.5A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="block flex-none fill-none stroke-current stroke-[1.5] [stroke-linecap:round] [stroke-linejoin:round]"
      style={{ width: size, height: size }}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
