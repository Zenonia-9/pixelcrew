import type { Agent } from "./types";
import { FLOOR_RIGHT, FLOOR_BOTTOM } from "./room-dimensions";
export type RoomRotation = 0 | 90 | 180 | 270;
export type RoomLayout = Record<
  string,
  {
    x: number;
    y: number;
    rotation?: RoomRotation;
    scale?: number;
    width?: number;
    height?: number;
  }
>;
export interface Furniture {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  obstacle?: [number, number, number, number];
}
export const deskStations: [number, number][] = [
  [352, 129],
  [142, 235],
  [560, 235],
  [352, 333],
  [142, 350],
  [560, 350],
  [142, 129],
  [560, 129],
  [704, 405],
  [455, 335],
  [245, 335],
  [455, 129],
];
export function furniture(agents: Agent[]): Furniture[] {
  return [
    {
      id: "rug",
      name: "Rug",
      x: 238,
      y: 101,
      width: 228,
      height: 290,
      depth: 0,
    },
    {
      id: "board",
      name: "Planning board",
      x: 278,
      y: 32,
      width: 148,
      height: 53,
      depth: 85,
    },
    {
      id: "bookshelf",
      name: "Bookshelf",
      x: 54,
      y: 139,
      width: 115,
      height: 43,
      depth: 182,
      obstacle: [52, 136, 174, 190],
    },
    {
      id: "tool-rack",
      name: "Tool rack",
      x: 536,
      y: 140,
      width: 112,
      height: 41,
      depth: 181,
      obstacle: [532, 136, 652, 190],
    },
    {
      id: "bed",
      name: "Bed",
      x: 47,
      y: 272,
      width: 124,
      height: 54,
      depth: 326,
      obstacle: [45, 274, 174, 326],
    },
    {
      id: "coffee",
      name: "Coffee stand",
      x: 538,
      y: 259,
      width: 90,
      height: 64,
      depth: 324,
      obstacle: [538, 254, 630, 324],
    },
    ...[
      [42, 88],
      [632, 88],
      [43, 350],
      [631, 350],
    ].map(([x, y], i) => ({
      id: `plant-${i}`,
      name: `Plant ${i + 1}`,
      x,
      y,
      width: 29,
      height: 44,
      depth: y + 44,
      obstacle: [x, y + 20, x + 29, y + 44] as [number, number, number, number],
    })),
    ...agents.map((a) => {
      const [x, y] = deskStations[a.workstation];
      return {
        id: `desk-${a.workstation}`,
        name: `${a.name}'s desk`,
        x: x - 43,
        y: y + 14,
        width: 86,
        height: 48,
        depth: y + 38,
        obstacle: [x - 48, y + 12, x + 48, y + 62] as [
          number,
          number,
          number,
          number,
        ],
      };
    }),
  ];
}
export function itemOffset(id: string, layout: RoomLayout, agents: Agent[]) {
  const item = furniture(agents).find((item) => item.id === id),
    saved = layout[id];
  return item && saved
    ? { x: saved.x - item.x, y: saved.y - item.y }
    : { x: 0, y: 0 };
}
export function furnitureSize(
  item: Furniture,
  rotation: RoomRotation = 0,
  scale = 1,
  dimensions: { width?: number; height?: number } = {},
) {
  const width = dimensions.width ?? item.width,
    height = dimensions.height ?? item.height;
  return rotation === 90 || rotation === 270
    ? { width: height * scale, height: width * scale }
    : { width: width * scale, height: height * scale };
}
export function furnitureBounds(item: Furniture, layout: RoomLayout) {
  const saved = layout[item.id];
  return {
    left: saved?.x ?? item.x,
    top: saved?.y ?? item.y,
    ...furnitureSize(item, saved?.rotation, saved?.scale, saved),
  };
}
export function transformFurniturePoint(
  item: Furniture,
  layout: RoomLayout,
  point: { x: number; y: number },
) {
  const saved = layout[item.id];
  const x = saved?.x ?? item.x,
    y = saved?.y ?? item.y;
  const scale = saved?.scale ?? 1;
  const sx = ((saved?.width ?? item.width) / item.width) * scale;
  const sy = ((saved?.height ?? item.height) / item.height) * scale;
  const width = item.width * sx,
    height = item.height * sy;
  const dx = (point.x - item.x) * sx,
    dy = (point.y - item.y) * sy;
  switch (saved?.rotation || 0) {
    case 90:
      return { x: x + height - dy, y: y + dx };
    case 180:
      return { x: x + width - dx, y: y + height - dy };
    case 270:
      return { x: x + dy, y: y + width - dx };
    default:
      return { x: x + dx, y: y + dy };
  }
}
export function roomItemPoint(
  id: string,
  layout: RoomLayout,
  agents: Agent[],
  point: { x: number; y: number },
) {
  const item = furniture(agents).find((item) => item.id === id);
  return item ? transformFurniturePoint(item, layout, point) : point;
}
export function placeFurniture(
  item: Furniture,
  x: number,
  y: number,
  rotation: RoomRotation = 0,
  scale = 1,
  dimensions: { width?: number; height?: number } = {},
) {
  scale = Math.max(0.5, Math.min(2, Math.round(scale * 4) / 4));
  const side = rotation === 90 || rotation === 270;
  dimensions = {
    ...(dimensions.width === undefined
      ? {}
      : {
          width: Math.max(
            8,
            Math.min((side ? 390 : 640) / scale, dimensions.width),
          ),
        }),
    ...(dimensions.height === undefined
      ? {}
      : {
          height: Math.max(
            8,
            Math.min((side ? 640 : 390) / scale, dimensions.height),
          ),
        }),
  };
  const baseSize = furnitureSize(item, rotation, 1, dimensions);
  const maximum =
    Math.floor(Math.min(2, 640 / baseSize.width, 390 / baseSize.height) * 4) /
    4;
  scale = Math.max(0.5, Math.min(maximum, Math.round(scale * 4) / 4));
  const size = furnitureSize(item, rotation, scale, dimensions);
  return {
    x: Math.max(32, Math.min(FLOOR_RIGHT - size.width, Math.round(x / 8) * 8)),
    y: Math.max(
      26,
      Math.min(FLOOR_BOTTOM - size.height, Math.round(y / 8) * 8),
    ),
    rotation,
    scale,
    ...(dimensions.width === undefined ? {} : { width: dimensions.width }),
    ...(dimensions.height === undefined ? {} : { height: dimensions.height }),
  };
}

export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export function resizeFurniture(
  item: Furniture,
  saved: RoomLayout[string],
  edge: ResizeEdge,
  dx: number,
  dy: number,
) {
  const bounds = furnitureBounds(item, { [item.id]: saved });
  let left = bounds.left,
    top = bounds.top,
    right = left + bounds.width,
    bottom = top + bounds.height;
  if (edge.includes("w")) left = Math.max(32, Math.min(right - 16, left + dx));
  if (edge.includes("e"))
    right = Math.min(FLOOR_RIGHT, Math.max(left + 16, right + dx));
  if (edge.includes("n")) top = Math.max(26, Math.min(bottom - 16, top + dy));
  if (edge.includes("s"))
    bottom = Math.min(FLOOR_BOTTOM, Math.max(top + 16, bottom + dy));
  const scale = saved.scale ?? 1,
    side = saved.rotation === 90 || saved.rotation === 270;
  const width = (side ? bottom - top : right - left) / scale,
    height = (side ? right - left : bottom - top) / scale;
  return {
    ...placeFurniture(item, left, top, saved.rotation, scale, {
      width,
      height,
    }),
    x: Math.round(left),
    y: Math.round(top),
  };
}
