import type { HostRegistrationRecord } from "@/model/host";
import { canonicalContent } from "@/model/version";
import { all, commitTransaction } from "./database";

async function updateHost(address: string, id: string, change: (record: HostRegistrationRecord) => HostRegistrationRecord | null): Promise<boolean> {
  return commitTransaction(["hosts"], "update hosts in", (transaction, fail, changed) => {
    const store = transaction.objectStore("hosts");
    const request: IDBRequest<HostRegistrationRecord | undefined> = store.get(address);
    let matched = false;
    request.onsuccess = () => {
      try {
        const current = request.result;
        if (current === undefined || current.id !== id) return;
        matched = true;
        const next = change(current);
        if (next === null) store.delete(address);
        else if (canonicalContent(next) !== canonicalContent(current)) store.put(next);
        else return;
        changed({ scope: "hosts", key: address });
      } catch (error) {
        fail(error);
      }
    };
    return () => matched;
  });
}

export const hostsDb = {
  all: async (): Promise<HostRegistrationRecord[]> => {
    return (await all("hosts")).sort((a, b) => a.order - b.order);
  },
  add: async (record: Omit<HostRegistrationRecord, "order">): Promise<HostRegistrationRecord> => {
    return commitTransaction(["hosts"], "add a host to", (transaction, fail, changed) => {
      const store = transaction.objectStore("hosts");
      const request: IDBRequest<HostRegistrationRecord[]> = store.getAll();
      let saved = { ...record, order: 0 };
      request.onsuccess = () => {
        try {
          const current = request.result.find((item) => item.address === record.address);
          saved = current ?? { ...record, order: Math.max(-1, ...request.result.map((item) => item.order)) + 1 };
          if (current !== undefined) return;
          store.put(saved);
          changed({ scope: "hosts", key: record.address });
        } catch (error) {
          fail(error);
        }
      };
      return () => saved;
    });
  },
  remove: (address: string, id: string): Promise<boolean> => updateHost(address, id, () => null),
  updateCredentials: (address: string, id: string, patch: Partial<Pick<HostRegistrationRecord, "token" | "gain">>): Promise<boolean> =>
    updateHost(address, id, (record) => ({
      ...record,
      ...(patch.token === undefined ? {} : { token: patch.token }),
      ...(patch.gain === undefined ? {} : { gain: patch.gain }),
    })),
  updateObservation: (address: string, id: string, patch: Pick<HostRegistrationRecord, "name" | "seen">): Promise<boolean> =>
    updateHost(address, id, (record) => {
      const acceptsObservation = record.seen === null
        || (patch.seen !== null && patch.seen.at >= record.seen.at);
      return acceptsObservation ? { ...record, ...patch } : record;
    }),
};
