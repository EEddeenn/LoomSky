type TrajectorySolve = {
  status: "converged" | "iterationLimit" | "infeasible" | "numericalFailure" | "verificationFailed";
  feasible: boolean;
  verified: boolean;
  iterations: number;
  objective: number;
  maxViolation: number;
  stationarity: number;
};

type TrajectoryEvent = {
  id: string;
  index: number;
  time: number;
  latitude: number;
  longitude: number;
  altitude: number;
  speed: number;
  course: number;
  velocityEcef: [number, number, number];
  accelerationEcef: [number, number, number];
};

type TrajectorySection = { id: string; from: string; to: string; start: number; end: number };

type TrajectorySample = {
  time: number;
  distance: number;
  latitude: number;
  longitude: number;
  altitude: number;
  speed: number;
  horizontalSpeed: number;
  forwardSpeed: number;
  up: number;
  acceleration: number;
  forwardAcceleration: number;
  jerk: number;
  forwardJerk: number;
  course: number;
  turnRate: number;
  lateralAcceleration: number;
};

type TrajectoryRule = {
  id: string;
  kind: "hard" | "target" | "objective";
  violation: number;
  residual: number;
  active: boolean;
};

export type TrajectoryInspection = {
  distance: number;
  duration: number;
  solve: TrajectorySolve;
  events: TrajectoryEvent[];
  sections: TrajectorySection[];
  samples: TrajectorySample[];
  rules: TrajectoryRule[];
};

export type GeometryPosition = { latitude: number; longitude: number };
type GeometryPath = { id: string; positions: GeometryPosition[] };
type GeometryRegion = GeometryPath & { radiusPoint: GeometryPosition | null };
export type GeometryInspection = { curves: GeometryPath[]; regions: GeometryRegion[] };
