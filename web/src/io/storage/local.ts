type LocalKey = "mapLabels" | "theme";

export function readLocal(key: LocalKey): string | null {
  try {
    return localStorage.getItem(`loomsky.${key}`);
  } catch {
    return null;
  }
}

export function writeLocal(key: LocalKey, value: string): void {
  try {
    localStorage.setItem(`loomsky.${key}`, value);
  } catch {
    return;
  }
}

export function onLocalChange(key: LocalKey, listener: () => void): () => void {
  const receive = (event: StorageEvent) => {
    if (event.storageArea === localStorage && (event.key === null || event.key === `loomsky.${key}`)) listener();
  };
  window.addEventListener("storage", receive);
  return () => window.removeEventListener("storage", receive);
}
