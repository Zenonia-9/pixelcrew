import type { Furniture, RoomLayout } from "./room-layout";

export interface OfficeRoom {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  material: "carpet" | "wood" | "tile";
}
export const roomPlans: Record<
  string,
  { rooms: OfficeRoom[]; dividers: number[][] }
> = {
  suite: {
    rooms: [
      {
        name: "Research",
        x: 32,
        y: 88,
        width: 224,
        height: 224,
        material: "carpet",
      },
      {
        name: "Team room",
        x: 272,
        y: 88,
        width: 256,
        height: 224,
        material: "wood",
      },
      {
        name: "Build lab",
        x: 544,
        y: 88,
        width: 256,
        height: 224,
        material: "tile",
      },
      {
        name: "Lounge & review",
        x: 32,
        y: 328,
        width: 768,
        height: 144,
        material: "carpet",
      },
    ],
    dividers: [
      [256, 88, 16, 112],
      [256, 256, 16, 56],
      [528, 88, 16, 112],
      [528, 256, 16, 56],
      [32, 312, 112, 16],
      [208, 312, 144, 16],
      [416, 312, 208, 16],
      [688, 312, 112, 16],
    ],
  },
  commons: {
    rooms: [
      {
        name: "Studio",
        x: 32,
        y: 88,
        width: 512,
        height: 384,
        material: "wood",
      },
      {
        name: "Coffee club",
        x: 544,
        y: 88,
        width: 256,
        height: 176,
        material: "wood",
      },
      {
        name: "Quiet corner",
        x: 544,
        y: 280,
        width: 256,
        height: 192,
        material: "tile",
      },
    ],
    dividers: [
      [528, 88, 16, 120],
      [528, 256, 16, 128],
      [528, 424, 16, 48],
      [544, 264, 96, 16],
      [704, 264, 96, 16],
    ],
  },
  focus: {
    rooms: [
      {
        name: "Reading room",
        x: 32,
        y: 88,
        width: 352,
        height: 176,
        material: "carpet",
      },
      {
        name: "Workshop",
        x: 448,
        y: 88,
        width: 352,
        height: 176,
        material: "wood",
      },
      {
        name: "Common room",
        x: 32,
        y: 336,
        width: 768,
        height: 136,
        material: "tile",
      },
    ],
    dividers: [
      [384, 88, 16, 112],
      [432, 88, 16, 112],
      [32, 264, 112, 16],
      [208, 264, 176, 16],
      [448, 264, 176, 16],
      [688, 264, 112, 16],
    ],
  },
};

// Divider identities live in the saved layout, so undo and team switching restore
// architecture together with furniture. Doorways are real gaps in navigation.
export const roomDividers: Furniture[] = Object.entries(roomPlans).flatMap(
  ([id, plan]) =>
    plan.dividers.map(([x, y, width, height], index) => ({
      id: `divider-${id}-${index}`,
      name: "Room partition",
      x,
      y,
      width,
      height,
      depth: y + height,
      obstacle: [x, y, x + width, y + height] as [
        number,
        number,
        number,
        number,
      ],
    })),
);
export const officeFixtures: Furniture[] = [
  {
    id: "bathroom-door",
    name: "Bathroom door",
    x: 213,
    y: 32,
    width: 38,
    height: 53,
    depth: 85,
    obstacle: [213, 32, 251, 85],
  },
  ...[
    [74, 32],
    [568, 32],
  ].map(([x, y], index) => ({
    id: `window-${index}`,
    name: `Window ${index + 1}`,
    x,
    y,
    width: 66,
    height: 47,
    depth: y + 47,
    obstacle: [x, y, x + 66, y + 47] as [number, number, number, number],
  })),
];
export function officeRoomPlan(layout: RoomLayout) {
  return Object.entries(roomPlans).find(
    ([id]) => layout[`divider-${id}-0`],
  )?.[1];
}
export function activeDividers(layout: RoomLayout) {
  return roomDividers.filter((item) => layout[item.id]);
}

export function officeRoomPlanId(layout: RoomLayout) {
  return Object.keys(roomPlans).find((id) => layout[`divider-${id}-0`]);
}
