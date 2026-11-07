import type { Agent } from "./types";
import { officeRoomPlanId } from "./office-rooms";
import { activityById, type IdleActivity } from "./office-life";
import { officeInteractions } from "./office-interactions";
import {
  furniture,
  furnitureBounds,
  roomItemPoint,
  type RoomLayout,
} from "./room-layout";
import { officePath, walkable, type Point } from "./office-motion";

export function nearestActivityTarget(
  activity: IdleActivity,
  from: Point,
  agents: Agent[],
  layout: RoomLayout,
): Point | undefined {
  if (activity === "restroom" && officeRoomPlanId(layout) === "commons") return undefined;
  if (activity === "stretch") {
    const rug = furniture(agents).find((item) => item.id === "rug")!;
    const bounds = furnitureBounds(rug, layout);
    const candidates: Point[] = [];
    for (
      let y = Math.ceil((bounds.top + Math.min(32, bounds.height / 2)) / 8) * 8;
      y <= bounds.top + bounds.height - 8;
      y += 8
    )
      for (
        let x =
          Math.ceil((bounds.left + Math.min(16, bounds.width / 2)) / 8) * 8;
        x <= bounds.left + bounds.width - Math.min(16, bounds.width / 2);
        x += 8
      )
        if (walkable({ x, y }, agents, layout)) candidates.push({ x, y });
    candidates.sort(
      (a, b) =>
        Math.hypot(a.x - from.x, a.y - from.y) -
        Math.hypot(b.x - from.x, b.y - from.y),
    );
    return candidates.find(
      (point) => officePath(from, point, agents, layout).length > 0,
    );
  }
  const destinations = officeInteractions(agents, layout).filter(
    (item) => item.activity === activity,
  );
  if (destinations.length) {
    return destinations
      .map((item) => officePath(from, item.target, agents, layout))
      .filter((path) => path.length)
      .sort((a, b) => a.length - b.length)[0]
      ?.at(-1);
  }
  if (activity === "coffee") {
    const coffee = furniture(agents).find((i) => i.id === "coffee")!;
    const b = furnitureBounds(coffee, layout);
    return { x: b.left + b.width / 2, y: b.top + b.height + 16 };
  }
  const definition = activityById(activity);
  if (!definition) return;
  const item = ({ nap: "bed", coffee: "coffee" } as Record<string, string>)[
    activity
  ];
  return item
    ? roomItemPoint(item, layout, agents, definition.target)
    : definition.target;
}
