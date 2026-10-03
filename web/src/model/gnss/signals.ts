export const systems = ["GPS", "BDS", "Galileo", "GLONASS"] as const;
export type System = (typeof systems)[number];

export const signals = ["L1CA", "L1C", "L2C", "L5", "B1C", "B1I", "B2I", "B3I", "B2a", "B2b", "E1", "E5a", "E5b", "E6", "G1", "G2"] as const;
export type Signal = (typeof signals)[number];

export const displayOrder: readonly System[] = ["GPS", "Galileo", "BDS", "GLONASS"];
export const narrowNames: Record<System, string> = { GPS: "GPS", BDS: "BDS", Galileo: "GAL", GLONASS: "GLO" };
const letters: Record<System, string> = { GPS: "G", BDS: "C", Galileo: "E", GLONASS: "R" };

export function isSystem(value: unknown): value is System {
  return systems.some((system) => system === value);
}

export function isSignal(value: unknown): value is Signal {
  return signals.some((signal) => signal === value);
}

export function satelliteName(system: System, svid: number): string {
  return `${letters[system]}${String(svid).padStart(2, "0")}`;
}
