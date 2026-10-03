"use client";

import { LibraryBrowser } from "../shared/resources/browser";
import { RecoverDrafts } from "../shared/resources/drafts";

export function LibraryWorkspace() {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Library">
      <div className="flex min-h-12 flex-none flex-wrap items-center gap-y-2 border-b border-line2 px-4 py-2">
        <h1 className="m-0 text-title font-semibold">Library</h1>
        <span className="flex-1" />
        <RecoverDrafts />
      </div>
      <LibraryBrowser />
    </section>
  );
}
