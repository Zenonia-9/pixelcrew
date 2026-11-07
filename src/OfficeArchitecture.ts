import { Container, Graphics, Text } from "pixi.js";
import { activeDividers, officeRoomPlan, officeRoomPlanId } from "../shared/office-rooms";
import { furnitureBounds, type RoomLayout } from "../shared/room-layout";
import { officeDesign } from "../shared/office-designs";

export function drawOfficeArchitecture(
  room: Container,
  layout: RoomLayout,
  design: string,
) {
  const plan = officeRoomPlan(layout);
  if (!plan) return;
  const planId = officeRoomPlanId(layout);
  const palette = officeDesign(design);
  const floor = new Graphics();
  floor.zIndex = -1;
  room.addChild(floor);
  for (const zone of plan.rooms) {
    const { x, y, width, height, material } = zone;
    const color =
      planId === "commons" && zone.name === "Quiet corner"
        ? "#263d4a"
        : material === "carpet"
        ? palette.trim
        : material === "tile"
          ? palette.tile
          : palette.floor;
    floor.rect(x, y, width, height).fill(color);
    // Long, low-contrast clusters keep furniture and characters readable.
    if (material === "wood") {
      for (let row = 0; row < height; row += 16) {
        floor
          .rect(x, y + row, width, 1)
          .fill({ color: palette.grout, alpha: 0.35 });
        for (let col = (row % 32) * 3; col < width; col += 96)
          floor
            .rect(x + col, y + row, 1, Math.min(16, height - row))
            .fill({ color: palette.grout, alpha: 0.35 });
      }
    } else if (material === "tile") {
      for (let row = 0; row < height; row += 32)
        floor
          .rect(x, y + row, width, 1)
          .fill({ color: palette.grout, alpha: 0.3 });
      for (let col = 0; col < width; col += 32)
        floor
          .rect(x + col, y, 1, height)
          .fill({ color: palette.grout, alpha: 0.3 });
    } else {
      floor
        .rect(x + 4, y + 4, width - 8, height - 8)
        .stroke({ color: palette.wall, alpha: 0.25, width: 2 });
    }
    // Fine inset trim gives each room a finished edge without competing with
    // the pixel-art furniture or the floor pattern.
    floor
      .rect(x + 2, y + 2, width - 4, height - 4)
      .stroke({ color: palette.wall, alpha: 0.32, width: 1 });
    const signWidth = Math.min(width - 16, Math.max(92, zone.name.length * 6 + 20));
    const signHeight = 18;
    let signY = y + 8;
    let labelCenterX = x + width / 2;
    if (planId === "commons") {
      signY = zone.name === "Studio" ? y + height - 34 : zone.name === "Coffee club" ? y + height - 20 : y + 40;
    }
    const positionedSignX = labelCenterX - signWidth / 2;
    if (planId !== "commons") {
      floor.rect(positionedSignX + 2, signY + 3, signWidth, signHeight).fill({
        color: "#101713",
        alpha: 0.32,
      });
      floor.rect(positionedSignX, signY, signWidth, signHeight).fill(palette.trim);
      floor
        .rect(positionedSignX + 1, signY + 1, signWidth - 2, signHeight - 2)
        .stroke({ color: palette.wall, alpha: 0.75, width: 1 });
    }
    const label = new Text({
      text: zone.name.toUpperCase(),
      style: {
        fontFamily: "Silkscreen",
        fontSize: planId === "commons" || zone.name.length > 17 ? 6 : 7,
        fill: planId === "commons" ? "#d8d6c8" : "#eee4ce",
        letterSpacing: planId === "commons" ? 1.2 : 0.5,
      },
    });
    label.position.set(labelCenterX, signY + (planId === "commons" ? 0 : 4));
    label.anchor.set(0.5, 0);
    label.zIndex = 2;
    label.alpha = 0.92;
    room.addChild(label);
  }
  for (const item of activeDividers(layout)) {
    const bounds = furnitureBounds(item, layout);
    const { left: x, top: y, width, height } = bounds;
    const wall = new Graphics();
    wall
      .rect(x + 3, y + 4, width, height)
      .fill({ color: "#142521", alpha: 0.25 });
    wall.rect(x, y - 12, width, height + 12).fill(palette.trim);
    wall
      .rect(x + 2, y - 9, Math.max(1, width - 4), height + 4)
      .fill(palette.wall);
    wall.rect(x, y - 14, width, 4).fill("#bcc1a0");
    if (width > height) {
      for (let panel = x + 32; panel < x + width - 16; panel += 48)
        wall.rect(panel, y - 8, 2, Math.max(4, height - 8)).fill({
          color: palette.trim,
          alpha: 0.42,
        });
    } else {
      wall.rect(x + 2, y + 10, Math.max(1, width - 4), 2).fill({
        color: "#d1c39e",
        alpha: 0.65,
      });
    }
    wall.rect(x, y + height - 3, width, 3).fill(palette.grout);
    wall.zIndex = y + height;
    room.addChild(wall);
  }
}
