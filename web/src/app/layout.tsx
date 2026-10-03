import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { condensed, mono, sans } from "@/page/shared/ui";
import "./globals.css";

export const metadata: Metadata = { icons: { icon: "data:," } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, colorScheme: "light" };

const theme = `try{document.documentElement.setAttribute("data-theme",localStorage.getItem("loomsky.theme")==="dark"?"dark":"light")}catch(e){document.documentElement.setAttribute("data-theme","light")}`;

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={`${sans.variable} ${condensed.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: theme }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
