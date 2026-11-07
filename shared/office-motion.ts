import { fixedOfficeWalls } from "./room-model";
import { activeDividers, officeFixtures } from "./office-rooms";
import type { Agent } from "./types";
import { FLOOR_RIGHT, FLOOR_BOTTOM } from "./room-dimensions";
import {
  deskStations,
  furniture,
  roomItemPoint,
  transformFurniturePoint,
  type RoomLayout,
} from "./room-layout";

export type Point = { x: number; y: number };
export const stations = deskStations;
export const home = (a: Agent, layout: RoomLayout = {}): Point => {
  const desk = roomItemPoint(`desk-${a.workstation}`, layout, [a], {
    x: stations[a.workstation][0],
    y: stations[a.workstation][1],
  });
  return walkable(desk, [a], layout) ? desk : nearestFloor(desk, [a], layout);
};

// Navigation uses the character's floor position. Desks and room furniture block
// routes, with a small margin around their edges. Art and runtime are independent.
function obstacles(agents: Agent[], layout: RoomLayout) {
  return [...furniture(agents), ...activeDividers(layout), ...officeFixtures, ...fixedOfficeWalls(layout)]
    .filter((item) => item.obstacle)
    .map((item) => {
      const [l, t, r, b] = item.obstacle!;
      const corners = [
        [l, t],
        [r, t],
        [r, b],
        [l, b],
      ].map(([x, y]) => transformFurniturePoint(item, layout, { x, y }));
      return [
        Math.min(...corners.map((p) => p.x)),
        Math.min(...corners.map((p) => p.y)),
        Math.max(...corners.map((p) => p.x)),
        Math.max(...corners.map((p) => p.y)),
      ];
    });
}
export function walkable(
  p: Point,
  agents: Agent[],
  layout: RoomLayout = {},
  blocks = obstacles(agents, layout),
) {
  if (
    p.x < 64 ||
    p.x > FLOOR_RIGHT - 32 ||
    p.y < 112 ||
    p.y > FLOOR_BOTTOM - 24
  )
    return false;
  const rects = blocks;
  return !rects.some(
    ([l, t, r, b]) => p.x >= l && p.x <= r && p.y >= t && p.y <= b,
  );
}

export function nearestFloor(
  target: Point,
  agents: Agent[],
  layout: RoomLayout = {},
  blocks = obstacles(agents, layout),
): Point {
  let best = { x: 352, y: 208 },
    distance = Infinity;
  for (let y = 112; y <= FLOOR_BOTTOM - 24; y += 8)
    for (let x = 64; x <= FLOOR_RIGHT - 32; x += 8) {
      const d = Math.hypot(x - target.x, y - target.y);
      if (d < distance && walkable({ x, y }, agents, layout, blocks)) {
        best = { x, y };
        distance = d;
      }
    }
  return best;
}

export function officePath(
  start: Point,
  target: Point,
  agents: Agent[],
  layout: RoomLayout = {},
): Point[] {
  const blocks = obstacles(agents, layout);
  const from = nearestFloor(start, agents, layout, blocks),
    to = nearestFloor(target, agents, layout, blocks);
  const key = (p: Point) => `${p.x},${p.y}`;
  const queue = [from],
    parent = new Map<string, Point | null>([[key(from), null]]);
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    if (key(p) === key(to)) {
      const route = [p];
      let previous = parent.get(key(p));
      while (previous) {
        route.unshift(previous);
        previous = parent.get(key(previous));
      }
      return route;
    }
    for (const [dx, dy] of [
      [8, 0],
      [-8, 0],
      [0, 8],
      [0, -8],
    ]) {
      const next = { x: p.x + dx, y: p.y + dy };
      if (!parent.has(key(next)) && walkable(next, agents, layout, blocks)) {
        parent.set(key(next), p);
        queue.push(next);
      }
    }
  }
  return [];
}

export function advancePath(
  position: Point,
  route: Point[],
  distance: number,
): { position: Point; route: Point[] } {
  let p = { ...position },
    rest = [...route];
  while (rest.length && distance > 0) {
    const next = rest[0],
      length = Math.hypot(next.x - p.x, next.y - p.y);
    if (length <= distance) {
      p = next;
      rest.shift();
      distance -= length;
    } else {
      p = {
        x: p.x + ((next.x - p.x) / length) * distance,
        y: p.y + ((next.y - p.y) / length) * distance,
      };
      distance = 0;
    }
  }
  return { position: p, route: rest };
}
