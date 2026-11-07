import { Container, Graphics } from "pixi.js";
import { officeDesign } from "../shared/office-designs";
import { furniture } from "../shared/room-layout";
import { furnitureView } from "../shared/furniture-views";
import type { RoomRotation } from "../shared/room-layout";
import { topDownFurniture } from "../shared/top-down-furniture";
import type { Agent } from "../shared/types";

export function drawRpgOffice(
  room: Container,
  design: string,
  agents: Agent[],
) {
  const palette = officeDesign(design);
  const floor = new Graphics();
  floor.zIndex = -2;
  room.addChild(floor);
  const r = (x: number, y: number, w: number, h: number, color: string) =>
    floor.rect(x, y, w, h).fill(color);
  r(16, 16, 804, 480, "#142522");
  r(24, 24, 784, 460, palette.trim);
  r(32, 84, 768, 390, palette.floor);
  const plank = ["wood", "plank"].includes(palette.pattern);
  const tileWidth = plank ? 64 : 32;
  for (let y = 84; y < 474; y += 16) {
    for (let x = 32; x < 800; x += tileWidth) {
      const alternate =
        (Math.floor((x - 32) / 32) + Math.floor((y - 84) / 16)) % 2;
      const width = Math.min(tileWidth, 800 - x);
      r(x, y, width, Math.min(16, 474 - y), palette.grout);
      r(
        x + 1,
        y + 1,
        width - 2,
        Math.min(14, 473 - y),
        plank ? palette.floor : alternate ? palette.tile : palette.floor,
      );
    }
  }
  // RPG cutaway: the north wall has height; side walls expose their top edges.
  const walls = new Graphics();
  walls.zIndex = 4;
  room.addChild(walls);
  const wr = (x: number, y: number, w: number, h: number, color: string) =>
    walls.rect(x, y, w, h).fill(color);
  wr(24, 18, 784, 68, palette.trim);
  wr(30, 26, 772, 50, palette.wall);
  wr(30, 26, 772, 4, "#bdc3a0");
  wr(30, 76, 772, 8, palette.grout);
  for (const x of [74, 568]) {
    wr(x, 34, 64, 40, palette.trim);
    wr(x + 4, 38, 56, 29, "#648c91");
    wr(x + 7, 40, 22, 24, "#a8c8ba");
    wr(x + 31, 38, 4, 29, palette.trim);
    wr(x - 2, 70, 68, 6, "#bd9c70");
  }
  wr(213, 32, 38, 53, palette.trim);
  wr(217, 36, 30, 49, "#876e50");
  wr(222, 42, 20, 17, "#b9c6af");
  wr(239, 68, 4, 4, "#e0bd75");
  for (const x of [180, 466]) {
    wr(x, 42, 8, 22, "#806647");
    wr(x - 3, 38, 14, 10, "#dfbd7d");
    wr(x + 1, 38, 6, 6, "#f6dfaa");
  }
  const edge = new Graphics();
  edge.zIndex = 10000;
  room.addChild(edge);
  edge.rect(24, 84, 8, 400).fill(palette.trim);
  edge.rect(24, 84, 4, 392).fill("#b29d77");
  edge.rect(800, 84, 8, 400).fill(palette.trim);
  edge.rect(800, 84, 4, 392).fill("#b29d77");
  edge.rect(24, 474, 784, 12).fill(palette.grout);
  edge.rect(24, 474, 784, 4).fill("#b29d77");
  const objects = new Map<string, Graphics>();
  for (const item of furniture(agents)) {
    const agent = agents.find((a) => item.id === `desk-${a.workstation}`);
    for (const facing of [0, 90, 180, 270] as RoomRotation[]) {
      if (item.id === "rug" && facing !== 0) continue;
      const graphic = new Graphics();
      const pixels =
        item.id === "rug"
          ? topDownFurniture(item)
          : furnitureView(item, facing, agent?.role);
      for (const pixel of pixels)
        graphic
          .rect(pixel.x, pixel.y, pixel.width, pixel.height)
          .fill(pixel.color);
      graphic.visible = facing === 0;
      room.addChild(graphic);
      objects.set(`${item.id}:${facing}`, graphic);
    }
  }
  return objects;
}
