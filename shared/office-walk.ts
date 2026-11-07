export type WalkDirection =
  | "down"
  | "down-left"
  | "left"
  | "up-left"
  | "up"
  | "up-right"
  | "right"
  | "down-right";
export const walkDirections: WalkDirection[] = [
  "down",
  "down-left",
  "left",
  "up-left",
  "up",
  "up-right",
  "right",
  "down-right",
];
export const walkFrames = 8;
export function walkDirection(
  from: { x: number; y: number },
  to: { x: number; y: number },
  fallback: WalkDirection = "down",
): WalkDirection {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  if (Math.abs(dx) + Math.abs(dy) < 0.5) return fallback;
  const clockwiseFromDown = Math.atan2(-dx, dy);
  return walkDirections[
    (Math.round(clockwiseFromDown / (Math.PI / 4)) + 8) % 8
  ];
}
