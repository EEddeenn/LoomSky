import { gpsClock, utcClock, type Leap } from "@/model/gnss";
import { Fig } from "./fig";

export function GpsTime({ gps, leap }: { gps: number; leap: Leap }) {
  return (
    <span title={`${utcClock(gps, leap)} UTC`}>
      <Fig>{`${gpsClock(gps)} GPS`}</Fig>
    </span>
  );
}
