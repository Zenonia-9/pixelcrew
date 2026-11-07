import type { Point } from "./office-motion";

// Decorative office life is independent of execution state and tool activity.
export const idleActivities = [
  {
    id: "nap",
    label: "Taking a nap",
    target: { x: 192, y: 312 },
    duration: 14000,
    frames: [7],
    marker: "Zzz",
  },
  {
    id: "plants",
    label: "Watering the plants",
    target: { x: 96, y: 368 },
    duration: 12000,
    frames: [2, 3],
    marker: "water",
  },
  {
    id: "restroom",
    label: "Restroom break",
    target: { x: 232, y: 112 },
    duration: 12000,
    frames: [7],
    marker: "break",
  },
  {
    id: "wander",
    label: "Taking a stroll",
    target: { x: 464, y: 376 },
    duration: 4000,
    frames: [0, 1],
    marker: "…",
  },
  {
    id: "read",
    label: "Reading a book",
    target: { x: 200, y: 168 },
    duration: 11000,
    frames: [2, 3],
    marker: "book",
  },
  {
    id: "coffee",
    label: "Having a coffee",
    target: { x: 512, y: 296 },
    duration: 10000,
    frames: [0, 1],
    marker: "cup",
  },
  {
    id: "stretch",
    label: "Stretching",
    target: { x: 288, y: 224 },
    duration: 9600,
    frames: [1, 2, 3, 2, 4, 2, 1, 5],
    marker: "↑",
  },
  {
    id: "window",
    label: "Watching the clouds",
    target: { x: 616, y: 112 },
    duration: 9000,
    frames: [0, 1],
    marker: "☁",
  },
] as const satisfies readonly {
  id: string;
  label: string;
  target: Point;
  duration: number;
  frames: readonly number[];
  marker: string;
}[];
export type IdleActivity = (typeof idleActivities)[number]["id"];
export const activityById = (id?: string) =>
  idleActivities.find((a) => a.id === id);
export const idleDelay = (random = Math.random()) =>
  60000 + Math.floor(Math.max(0, Math.min(1, random)) * 40000);
export const isOfficeBusy = (status?: string) =>
  ["queued", "running", "approval"].includes(status || "");
export const officeRunIndicator = (run?: { demo?: boolean; status?: string }) =>
  !isOfficeBusy(run?.status) ? undefined : run?.demo ? "simulated" : "live";
export interface JourneyClock {
  phase: "walking" | "activity" | "returning";
  walkingStartedAt: number;
  activityStartedAt?: number;
  activityDurationMs: number;
}
export function updateJourneyClock<T extends JourneyClock>(
  clock: T,
  arrived: boolean,
  now: number,
): T {
  return clock.phase === "walking" && arrived
    ? { ...clock, phase: "activity", activityStartedAt: now }
    : clock;
}
export const activityRemainingMs = (clock: JourneyClock, now: number) =>
  Math.max(
    0,
    clock.activityDurationMs -
      (clock.activityStartedAt === undefined
        ? 0
        : now - clock.activityStartedAt),
  );
export const journeyLabel = (clock: JourneyClock, now: number) =>
  clock.phase === "activity" && !Number.isFinite(clock.activityDurationMs)
    ? "Working"
    : clock.phase === "activity"
      ? `Doing · ${Math.ceil(activityRemainingMs(clock, now) / 1000)}s left`
      : `${clock.phase === "walking" ? "Walking" : "Returning"} · ${Math.floor(Math.max(0, now - clock.walkingStartedAt) / 1000)}s`;
