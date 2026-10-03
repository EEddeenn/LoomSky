import localFont from "next/font/local";

export const sans = localFont({
  variable: "--font-plex-sans",
  display: "swap",
  src: [
    { path: "../../../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../../../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
});

export const condensed = localFont({
  variable: "--font-plex-cond",
  display: "swap",
  src: [
    { path: "../../../../node_modules/@fontsource/ibm-plex-sans-condensed/files/ibm-plex-sans-condensed-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../../../../node_modules/@fontsource/ibm-plex-sans-condensed/files/ibm-plex-sans-condensed-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
});

export const mono = localFont({
  variable: "--font-plex-mono",
  display: "swap",
  src: [
    { path: "../../../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-italic.woff2", weight: "400", style: "italic" },
    { path: "../../../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../../../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
});
