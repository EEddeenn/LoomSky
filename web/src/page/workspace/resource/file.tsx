import type { LibraryFileRecord } from "@/model/library";
import type { ResourceRoute } from "@/workbench/navigation";
import { FileDetails } from "@/page/shared/resources/file";
import type { ResourceSummary } from "@/page/shared/resources/summary";
import { ResourceHeader } from "./header";

export function FileResource({ file, entry, route }: { file: LibraryFileRecord; entry: ResourceSummary; route: ResourceRoute }) {
  return <>
    <ResourceHeader entry={entry} route={route} status={<><span>Stored locally</span><span className="fn text-ink3">{entry.secondary}</span></>} available />
    <div className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain bg-face">
      <FileDetails file={file} expanded />
    </div>
  </>;
}
