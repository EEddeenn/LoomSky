import { scenarioCatalog } from "@/workbench/documents/scenario";

export function libraryFileUsage(digest: string): string[] {
  const users: string[] = [];
  for (const entry of scenarioCatalog.get().entries.values()) {
    if (entry.head.archivedAt !== null) continue;
    const summary = entry.working?.summary ?? entry.head.summary;
    if (summary.fileDigests.includes(digest)) users.push(summary.name || entry.head.id);
  }
  return users;
}
