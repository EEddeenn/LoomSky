import { createStore } from "@/core";
import { addressOf, clearBasemaps, closeBasemap, openBasemap } from "@/io/basemaps";
import { deleteBasemapAddress, loadBasemapAddresses, onLocalChange, onStorageChanges, readLocal, saveBasemapAddress, writeLocal } from "@/io/storage";
import type { Basemap, Refusal } from "@/model/basemap";
import { log, reportProblem, resolveProblem, toast } from "@/workbench/feedback";

type Unopened = { url: string; refusal: Refusal };

export const basemaps = createStore<{ list: Basemap[]; unopened: Unopened[]; loaded: boolean; labels: boolean }>({ list: [], unopened: [], loaded: false, labels: readLocal("mapLabels") !== "false" });
const opened = new Map<string, AbortController>();
const adding = new Set<AbortController>();
let active = false;
let generation = 0;

function shortOf(url: string): string { return url.replace(/^https?:\/\//i, ""); }
function order(list: Basemap[]): Basemap[] { return list.toSorted((a, b) => a.maxZoom - b.maxZoom || a.url.localeCompare(b.url)); }

function report(error: unknown): void {
  reportProblem({ id: "basemaps:storage", scope: "Basemaps", level: "error", title: "Could not refresh basemaps", message: error instanceof Error ? error.message : String(error) });
}

async function refresh(): Promise<void> {
  const request = ++generation;
  const addresses = await loadBasemapAddresses();
  if (!active || request !== generation) return;
  const wanted = new Set(addresses);
  for (const [url, controller] of opened) {
    if (wanted.has(url)) continue;
    controller.abort();
    opened.delete(url);
    closeBasemap(url);
  }
  basemaps.set((state) => ({ list: state.list.filter((item) => wanted.has(item.url)), unopened: state.unopened.filter((item) => wanted.has(item.url)), loaded: true }));
  resolveProblem("basemaps:storage");
  await Promise.all(addresses.map(async (url) => {
    if (opened.has(url)) return;
    const controller = new AbortController();
    opened.set(url, controller);
    try {
      const result = await openBasemap(url, controller.signal);
      if (!active || opened.get(url) !== controller) return;
      if ("kind" in result) {
        opened.delete(url);
        controller.abort();
      }
      basemaps.set((state) => ({
        list: order([...state.list.filter((item) => item.url !== url), ...("kind" in result ? [] : [result])]),
        unopened: [...state.unopened.filter((item) => item.url !== url), ...("kind" in result ? [{ url, refusal: result }] : [])],
      }));
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    }
  }));
}

export function startBasemaps(): () => void {
  active = true;
  basemaps.set({ labels: readLocal("mapLabels") !== "false" });
  const stopLabels = onLocalChange("mapLabels", () => basemaps.set({ labels: readLocal("mapLabels") !== "false" }));
  const stopStorage = onStorageChanges((change) => {
    if (change === null || change.scope === "basemaps") void refresh().catch(report);
  });
  void refresh().catch(report);
  return () => {
    active = false;
    generation++;
    stopLabels();
    stopStorage();
    for (const controller of [...opened.values(), ...adding]) controller.abort();
    opened.clear();
    adding.clear();
    clearBasemaps();
    basemaps.set({ list: [], unopened: [], loaded: false });
  };
}

export async function addBasemap(input: string): Promise<Refusal | null> {
  const url = addressOf(input);
  if (url === null) return { kind: "address" };
  if (!active) throw new DOMException("The workbench is closed", "AbortError");
  const controller = new AbortController();
  adding.add(controller);
  try {
    const result = await openBasemap(url, controller.signal, false);
    if ("kind" in result) return result;
    controller.signal.throwIfAborted();
    await saveBasemapAddress(url);
    if (!basemaps.get().list.some((item) => item.url === url)) {
      opened.get(url)?.abort();
      opened.delete(url);
    }
    if (active) await refresh();
    toast(`Saved ${shortOf(url)} in this browser`);
    log("", `Basemap added · ${url}`, "action");
    return null;
  } finally {
    adding.delete(controller);
    controller.abort();
  }
}

export async function removeBasemap(url: string): Promise<void> {
  await deleteBasemapAddress(url);
  if (active) await refresh();
  toast(`Removed ${shortOf(url)} from this browser`, "info");
}

export function setMapLabels(labels: boolean): void {
  writeLocal("mapLabels", String(labels));
  basemaps.set({ labels });
}
