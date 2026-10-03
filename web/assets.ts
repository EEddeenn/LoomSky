import { copyFileSync, existsSync, mkdirSync } from "node:fs";

const sources = [
  "../zig-out/web/pharos_traj.wasm",
  "../zig-out/web/pharos_pack.wasm",
  "../zig-out/web/pharos_obs.wasm",
  "../zig-out/web/trajectory.schema.json",
  "../zig-out/web/scenario.schema.json",
  "node_modules/maplibre-gl/dist/maplibre-gl.mjs",
  "node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs",
  "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs",
];

const missing = sources.filter((path) => !existsSync(path));
if (missing.length > 0) {
  console.error(`assets: missing ${missing.join(", ")}; run zig build web in the repository first`);
  process.exit(1);
}
mkdirSync("public", { recursive: true });
for (const path of sources) copyFileSync(path, `public/${path.slice(path.lastIndexOf("/") + 1)}`);
