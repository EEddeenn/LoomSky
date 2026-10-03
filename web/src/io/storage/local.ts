type LocalKey = "mapLabels" | "theme";
type SessionKey = `view:${string}`;

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

export function readSession(key: SessionKey): string | null {
  try {
    return sessionStorage.getItem(`loomsky.${key}`);
  } catch {
    return null;
  }
}

export function writeSession(key: SessionKey, value: string): void {
  try {
    sessionStorage.setItem(`loomsky.${key}`, value);
  } catch {
    return;
  }
}
