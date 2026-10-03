import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

export default function config(phase: string): NextConfig {
  return {
    images: { unoptimized: true },
    ...(phase === PHASE_DEVELOPMENT_SERVER ? {
      async rewrites() {
        return [
          { source: "/library", destination: "/" },
          { source: "/resource/:kind(scenario|trajectory|host|file)/:id/:tab?", destination: "/" },
        ];
      },
    } : { output: "export" }),
  };
}
