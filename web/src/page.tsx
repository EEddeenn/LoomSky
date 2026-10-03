"use client";

import { useEffect } from "react";
import { startWorkbench } from "@/workbench";
import { theme } from "@/workbench/theme";
import { Announcer } from "./page/announcer";
import { Header } from "./page/header";
import { Narrow } from "./page/narrow";
import { Cards } from "./page/overlays/cards";
import { ActivityPanel } from "./page/overlays/activity";
import { TransmitDialog } from "./page/overlays/transmit";
import { LibraryPicker } from "./page/overlays/library-picker";
import { TabSignal } from "./page/status";
import { Workspace } from "./page/workspace";
import { startDocumentShortcuts } from "./page/document-shortcuts";

export function App() {
  useEffect(() => {
    const syncTheme = () => { document.documentElement.dataset.theme = theme.get().theme; };
    syncTheme();
    const stopTheme = theme.subscribe(syncTheme);
    const stopWorkbench = startWorkbench();
    const stopDocumentShortcuts = startDocumentShortcuts();
    return () => {
      stopDocumentShortcuts();
      stopWorkbench();
      stopTheme();
    };
  }, []);

  return (
    <>
      <div className="h-full max-[1023px]:hidden">
        <div id="app" className="relative grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-panel">
          <Header />
          <Workspace />
          <Cards />
          <TransmitDialog />
          <LibraryPicker />
          <ActivityPanel />
        </div>
      </div>
      <Narrow />
      <Announcer />
      <TabSignal />
    </>
  );
}
