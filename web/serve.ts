import { createReadStream, fstatSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const [address = "127.0.0.1:3000"] = process.argv.slice(2);
const colon = address.lastIndexOf(":");
const host = address.slice(0, colon).replace(/^\[|\]$/g, "");
const port = Number(address.slice(colon + 1));
if (colon < 0 || !Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`serve: ${address} is no address:port`);
  process.exit(2);
}
const root = join(import.meta.dirname, "out");

function requestPath(url: string): { pathname: string; file: string } | null {
  try {
    const pathname = new URL(url, "http://page").pathname;
    return { pathname, file: normalize(decodeURIComponent(pathname)) };
  } catch (error) {
    if (error instanceof URIError || error instanceof TypeError) return null;
    throw error;
  }
}

function file(path: string): string | null {
  for (const candidate of [path, `${path}.html`, join(path, "index.html")]) {
    const full = join(root, candidate);
    if (!full.startsWith(root)) return null;
    try {
      if (statSync(full).isFile()) return full;
    } catch {
      continue;
    }
  }
  return null;
}

createServer((request, response) => {
  const target = requestPath(request.url ?? "/");
  if (target === null) {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("bad request target\n");
    return;
  }
  const page = /^\/library\/?$/.test(target.pathname) || /^\/resource\/(?:scenario|trajectory|host|file)\/[^/]+(?:\/[^/]+)?\/?$/.test(target.pathname);
  const path = request.method === "GET" || request.method === "HEAD" ? file(target.file) ?? (page ? file("/index.html") : null) : null;
  if (path === null) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("no such file\n");
    return;
  }
  const input = createReadStream(path);
  const fail = () => {
    input.destroy();
    if (response.destroyed) return;
    if (response.headersSent) response.destroy();
    else response.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end("cannot read file\n");
  };
  response.once("close", () => input.destroy());
  input.once("error", fail);
  input.once("open", (fd) => {
    if (response.destroyed) return;
    try {
      const info = fstatSync(fd);
      if (!info.isFile()) {
        fail();
        return;
      }
      response.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream", "content-length": info.size });
      if (request.method === "HEAD") {
        input.destroy();
        response.end();
      } else input.pipe(response);
    } catch {
      fail();
    }
  });
})
  .on("error", (error) => {
    console.error(`serve: cannot serve on ${address}: ${error.message}`);
    process.exit(1);
  })
  .listen(port, host, () => console.error(`serve: the page on http://${address}`));
