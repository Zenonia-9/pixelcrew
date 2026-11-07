import test from "node:test";
import assert from "node:assert/strict";
import { furnitureView } from "../shared/furniture-views";
import {
  furniture,
  furnitureSize,
  type RoomRotation,
} from "../shared/room-layout";
import { starterTeam } from "../shared/defaults";

test("furniture has separately drawn side and back views within its bounds", () => {
  for (const item of furniture(starterTeam.agents).filter(
    (item) => item.id !== "rug",
  )) {
    for (const facing of [0, 90, 180, 270] as RoomRotation[]) {
      const pixels = furnitureView(item, facing, "builder"),
        size = furnitureSize(item, facing);
      assert.ok(pixels.length, item.id);
      assert.ok(
        pixels.every(
          (pixel) =>
            pixel.x >= 0 &&
            pixel.y >= 0 &&
            pixel.x + pixel.width <= size.width &&
            pixel.y + pixel.height <= size.height,
        ),
        `${item.id}:${facing}`,
      );
    }
  }
  const desk = furniture(starterTeam.agents).find(
    (item) => item.id === "desk-2",
  )!;
  assert.notDeepEqual(
    furnitureView(desk, 90, "builder"),
    furnitureView(desk, 270, "builder"),
  );
  const shelf = furniture(starterTeam.agents).find(
    (item) => item.id === "bookshelf",
  )!;
  assert.notDeepEqual(furnitureView(shelf, 180), furnitureView(shelf, 90));
});
