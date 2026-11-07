import {
  furnitureBounds,
  type Furniture,
  type RoomLayout,
} from "./room-layout";
import { officeFixtures } from "./office-rooms";
export const isReferenceRoom = (layout: RoomLayout) =>
  !!layout["divider-commons-0"];
export function bathroomDoor(layout: RoomLayout) {
  return isReferenceRoom(layout)
    ? {
        x: 200,
        y: 368,
        width: 48,
        height: 76,
        axis: "y" as const,
        target: { x: 232, y: 392 },
        bounds: { left: 192, top: 368, width: 24, height: 64 },
      }
    : (() => {
        const item = officeFixtures[0];
        const bounds = furnitureBounds(item, layout);
        return {
          x: bounds.left,
          y: bounds.top + 2,
          width: bounds.width,
          height: Math.max(8, bounds.height - 14),
          axis: "x" as const,
          target: {
            x: bounds.left + bounds.width / 2,
            y: bounds.top + bounds.height + 27,
          },
          bounds: {
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
            height: bounds.height,
          },
        };
      })();
}
export function fixedOfficeWalls(layout: RoomLayout): Furniture[] {
  return isReferenceRoom(layout)
    ? [
        {
          id: "bathroom-north-wall",
          name: "Bathroom wall",
          x: 32,
          y: 304,
          width: 176,
          height: 8,
          depth: 312,
          obstacle: [32, 304, 208, 312],
        },
      ]
    : [];
}
