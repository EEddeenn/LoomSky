"use client";

import dynamic from "next/dynamic";

const App = dynamic(() => import("@/page").then((m) => m.App), { ssr: false });

export default function Page() {
  return <App />;
}
