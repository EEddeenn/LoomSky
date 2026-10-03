import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

type Entry = { version?: string; license?: string; dependencies?: Record<string, string> };

const manifest: { dependencies: Record<string, string> } = JSON.parse(readFileSync("package.json", "utf8"));
const lock: { packages: Record<string, Entry> } = JSON.parse(readFileSync("package-lock.json", "utf8"));

const packages = new Set<string>();
const pending = Object.keys(manifest.dependencies).map((name) => locate(name, ""));
while (pending.length > 0) {
  const path = pending.pop();
  if (path === undefined || packages.has(path)) continue;
  const entry = lock.packages[path] ?? {};
  const children = Object.keys(entry.dependencies ?? {});
  packages.add(path);
  for (const child of children) pending.push(locate(child, path));
}

const framework = locate("next", "");
const bundled = bundledNotices(join(framework, "dist", "compiled")).sort();
const parts = [...packages]
  .sort((a, b) => a.localeCompare(b))
  .map((path) => {
    const entry = lock.packages[path] ?? {};
    const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    return `${name} ${entry.version ?? ""} · ${entry.license ?? "see below"}\n\n${noticeText(path, entry.license)}`;
  });
for (const file of bundled) parts.push(`next/${relative(framework, file)}\n\n${readFileSync(file, "utf8").trim()}`);

writeFileSync(
  "out/licenses.txt",
  `Notices for the page's dependencies and the framework's bundled third-party code.\n${packages.size} packages and ${bundled.length} bundled notice files.\n\n${parts.join(`\n\n${"-".repeat(72)}\n\n`)}\n`,
);
console.error(`licenses: out/licenses.txt, ${packages.size} packages and ${bundled.length} bundled notices`);

function locate(name: string, from: string): string {
  for (let base = from; ; base = base.slice(0, Math.max(0, base.lastIndexOf("/node_modules/")))) {
    const path = `${base === "" ? "" : `${base}/`}node_modules/${name}`;
    if (path in lock.packages) return path;
    if (base === "") throw new Error(`licenses: ${name} is not in the lockfile`);
  }
}

function noticeText(path: string, license: string | undefined): string {
  const notices = readdirSync(path, { withFileTypes: true })
    .filter((file) => file.isFile() && /^(licen[cs]e|copying|notice)/i.test(file.name))
    .map((file) => file.name)
    .sort();
  if (notices.length > 0) {
    return notices
      .map((file) => readFileSync(join(path, file), "utf8").trim())
      .join("\n\n");
  }
  if (license === undefined) throw new Error(`licenses: ${path} carries no licence file or licence identifier`);
  return `Declared licence: ${license}. The published package includes no separate licence text.`;
}

function bundledNotices(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const file = join(path, entry.name);
    if (entry.isDirectory()) return bundledNotices(file);
    return entry.isFile() && /^(licen[cs]e|copying|notice)/i.test(entry.name) ? [file] : [];
  });
}
