import { stateWidth, type Track } from "./track";
import type { Plan, PlanPoint, PlanPosition } from "./plan/source";

type Position = { lat: number; lon: number };
const wgs84SemiMajorM = 6_378_137;
const wgs84EccentricitySquared = 0.00669437999014;
const degreesToRadians = Math.PI / 180;

function metric(latitude: number): { east: number; north: number } {
  const sine = Math.sin(latitude * degreesToRadians);
  const squared = 1 - wgs84EccentricitySquared * sine * sine;
  const prime = wgs84SemiMajorM / Math.sqrt(squared);
  return { east: prime * Math.cos(latitude * degreesToRadians), north: (prime * (1 - wgs84EccentricitySquared)) / squared };
}

function offsetPoint(origin: Position, east: number, north: number): Position {
  const scale = metric(origin.lat);
  return { lat: origin.lat + north / scale.north / degreesToRadians, lon: origin.lon + east / scale.east / degreesToRadians };
}

export function vector(origin: Position, point: Position): { east: number; north: number; length: number; course: number } {
  const scale = metric(origin.lat);
  const east = (((point.lon - origin.lon + 540) % 360) - 180) * degreesToRadians * scale.east;
  const north = (point.lat - origin.lat) * degreesToRadians * scale.north;
  return { east, north, length: Math.hypot(east, north), course: (Math.atan2(east, north) / degreesToRadians + 360) % 360 };
}

export function directionPoint(origin: Position, course: number, length: number): Position {
  return offsetPoint(origin, Math.sin(course * degreesToRadians) * length, Math.cos(course * degreesToRadians) * length);
}

export function pointPosition(point: PlanPoint): Position {
  return { lat: point.position.latitude, lon: point.position.longitude };
}

export function pointsOf(track: Track | null, start = 0, end = Number.POSITIVE_INFINITY): Position[] {
  if (track === null) return [];
  const points: Position[] = [];
  for (let i = 0; i < track.states.length; i += stateWidth) {
    const time = track.states[i] ?? 0;
    if (time >= start && time <= end) points.push({ lat: track.states[i + 1] ?? 0, lon: track.states[i + 2] ?? 0 });
  }
  return points;
}

export function distanceOf(track: Track | null): number {
  return track?.inspection?.distance ?? 0;
}

export function eventPosition(plan: Plan, id: string, track: Track | null): PlanPosition | null {
  const resolved = track?.inspection?.events.find((event) => event.id === id);
  if (resolved !== undefined) return { latitude: resolved.latitude, longitude: resolved.longitude, altitude: resolved.altitude };
  for (const kind of ["hard", "target"] as const) {
    for (const rule of plan.rules) {
      if (!("quantity" in rule) || rule.quantity !== "position" || !("event" in rule.scope) || rule.scope.event !== id || rule.kind !== kind) continue;
      const value = rule.kind === "hard" ? rule.eq : rule.kind === "target" ? rule.value : undefined;
      if (typeof value !== "object" || !("point" in value)) continue;
      const point = plan.geometry.points.find((point) => point.id === value.point);
      if (point !== undefined) return point.position;
    }
  }
  return plan.initialGuess?.states?.find((state) => state.event === id)?.position ?? null;
}

export function eventCourse(plan: Plan, id: string, track: Track | null): number {
  for (const rule of plan.rules) {
    if (!("quantity" in rule) || rule.quantity !== "course" || !("event" in rule.scope) || rule.scope.event !== id) continue;
    const value = rule.kind === "hard" ? rule.eq : rule.kind === "target" ? rule.value : undefined;
    if (typeof value === "number") return value;
  }
  return plan.initialGuess?.states?.find((state) => state.event === id)?.course ?? track?.inspection?.events.find((event) => event.id === id)?.course ?? 0;
}
