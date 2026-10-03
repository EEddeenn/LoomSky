import { FetchSource, PMTiles, Protocol, TileType } from "pmtiles";
import { recordOf, stringOf } from "@/core";
import type { Basemap, Refusal } from "@/model/basemap";

export const answerMs = 5000;
export const protocol = new Protocol();

class NoAnswer extends Error {}

export function addressOf(input: string): string | null {
  const trimmed = input.trim();
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username !== "" || url.password !== "") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

async function probe(url: string, owner?: AbortSignal): Promise<Refusal | null> {
  const signal = owner === undefined ? AbortSignal.timeout(answerMs) : AbortSignal.any([owner, AbortSignal.timeout(answerMs)]);
  let head: Response | null = null;
  try {
    head = await fetch(url, { headers: { range: "bytes=0-6" }, cache: "no-store", signal });
    if (head.status !== 206) {
      await head.body?.cancel();
      return head.status === 200 ? { kind: "ranges" } : { kind: "http", code: head.status };
    }
    return new TextDecoder().decode(await head.arrayBuffer()) === "PMTiles" ? null : { kind: "format" };
  } catch {
    owner?.throwIfAborted();
    if (head !== null || signal.aborted) return { kind: "noanswer" };
    try {
      await fetch(url, { method: "HEAD", mode: "no-cors", cache: "no-store", signal });
      return { kind: "origin" };
    } catch {
      owner?.throwIfAborted();
      return { kind: "noanswer" };
    }
  }
}

export async function openBasemap(url: string, owner?: AbortSignal, register = true): Promise<Basemap | Refusal> {
  owner?.throwIfAborted();
  const refusal = await probe(url, owner);
  if (refusal !== null) return refusal;
  try {
    const source = new FetchSource(url);
    const tiles = new PMTiles({
      getKey: () => source.getKey(),
      async getBytes(offset, length, signal, etag) {
        const timeout = AbortSignal.timeout(answerMs);
        try {
          return await source.getBytes(offset, length, AbortSignal.any([timeout, ...(signal === undefined ? [] : [signal]), ...(owner === undefined ? [] : [owner])]), etag);
        } catch (error) {
          if (timeout.aborted || error instanceof TypeError) throw new NoAnswer();
          throw error;
        }
      },
    });
    const header = await tiles.getHeader();
    if (header.tileType !== TileType.Mvt) return { kind: "raster" };
    const metadata: unknown = await tiles.getMetadata();
    owner?.throwIfAborted();
    if (register) protocol.add(tiles);
    return {
      url,
      minZoom: header.minZoom,
      maxZoom: header.maxZoom,
      bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
      attribution: stringOf(recordOf(metadata)?.attribution)?.replace(/<[^>]*>/g, "") ?? "",
    };
  } catch (error) {
    owner?.throwIfAborted();
    return { kind: error instanceof NoAnswer ? "noanswer" : "format" };
  }
}

export function closeBasemap(url: string): void {
  protocol.tiles.delete(url);
}

export function clearBasemaps(): void {
  protocol.tiles.clear();
}
