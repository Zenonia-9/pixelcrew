import { bathroomDoor } from "./room-model";
import { officeFixtures, officeRoomPlanId } from "./office-rooms";
import type { Agent } from "./types";
import type { IdleActivity } from "./office-life";
import {
  furniture,
  furnitureBounds,
  transformFurniturePoint,
  type RoomLayout,
} from "./room-layout";

export function officeInteractions(agents: Agent[], layout: RoomLayout) {
  const items = furniture(agents).filter(
    (item) => item.id === "bookshelf" || item.id.startsWith("plant-"),
  );
  return [
    ...items.map((item) => {
      const plant = item.id.startsWith("plant-");
      return {
        id: item.id,
        label: plant ? `Water ${item.name.toLowerCase()}` : "Read at bookshelf",
        activity: (plant ? "plants" : "read") as IdleActivity,
        bounds: furnitureBounds(item, layout),
        target: transformFurniturePoint(
          item,
          layout,
          plant ? { x: item.x + 53, y: item.y + 18 } : { x: 200, y: 168 },
        ),
      };
    }),
    ...(officeRoomPlanId(layout) === "commons" ? [] : [{
      id: "restroom",
      label: "Use bathroom",
      activity: "restroom" as IdleActivity,
      bounds: bathroomDoor(layout).bounds,
      target: bathroomDoor(layout).target,
    }]),
    ...officeFixtures.filter((item) => item.id.startsWith("window-")).map((item) => {
      const bounds = furnitureBounds(item, layout);
      return {
        id: item.id,
        label: `Look out ${item.name.toLowerCase()}`,
        activity: "window" as IdleActivity,
        bounds,
        target: { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height + 33 },
      };
    }),
  ];
}
