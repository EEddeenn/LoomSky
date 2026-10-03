import { all, commitTransaction } from "./database";

export async function loadBasemapAddresses(): Promise<string[]> {
  return (await all("basemaps")).map((record) => record.url);
}

export async function saveBasemapAddress(url: string): Promise<void> {
  await commitTransaction(["basemaps"], "save a basemap in", (transaction, _fail, changed) => {
    transaction.objectStore("basemaps").put({ url });
    changed({ scope: "basemaps", key: url });
    return () => undefined;
  });
}

export async function deleteBasemapAddress(url: string): Promise<void> {
  await commitTransaction(["basemaps"], "remove a basemap from", (transaction, _fail, changed) => {
    transaction.objectStore("basemaps").delete(url);
    changed({ scope: "basemaps", key: url });
    return () => undefined;
  });
}
