import type { HostClass } from "@/workbench/hosts";

const rf = "#c8251b";
const fault = "#a8147e";
const glyphs: Record<HostClass, string> = {
  onair: `<rect x="2" y="2" width="28" height="28" rx="3" fill="${rf}"/><circle cx="16" cy="16" r="6" fill="white"/>`,
  armed: `<rect x="4.5" y="4.5" width="23" height="23" rx="2" fill="none" stroke="${rf}" stroke-width="5"/>`,
  unknown: `<defs>
    <pattern id="stripes" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="7" height="7" fill="white"/><path d="M0 0V7" stroke="${rf}" stroke-width="2.5"/>
    </pattern>
  </defs><rect x="3" y="3" width="26" height="26" rx="2" fill="url(#stripes)"/>
  <rect x="4" y="4" width="24" height="24" rx="2" fill="none" stroke="${rf}" stroke-width="3.5" stroke-dasharray="6 3"/>`,
  alarm: `<path d="M16 4 29.5 27.5 2.5 27.5Z" fill="none" stroke="${fault}" stroke-width="4" stroke-linejoin="round"/>`,
  off: '<rect x="8" y="8" width="16" height="16" rx="2" fill="none" stroke="#767676" stroke-width="3"/>',
};

function icon(kind: HostClass): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${glyphs[kind]}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const favicons: Record<HostClass, string> = {
  onair: icon("onair"), armed: icon("armed"), unknown: icon("unknown"), alarm: icon("alarm"), off: icon("off"),
};
