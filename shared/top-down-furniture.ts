import type { Furniture } from "./room-layout";
import type { FurniturePixel } from "./furniture-views";

// Draw on the original furniture footprint; the office rotates the whole overhead view.
export function topDownFurniture(
  item: Furniture,
  role?: string,
): FurniturePixel[] {
  const { width: w, height: h, id } = item;
  const pixels: FurniturePixel[] = [];
  const r = (
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
  ) => {
    x = Math.max(0, Math.round(x));
    y = Math.max(0, Math.round(y));
    width = Math.min(w - x, Math.round(width));
    height = Math.min(h - y, Math.round(height));
    if (width > 0 && height > 0) pixels.push({ x, y, width, height, color });
  };
  const panel = (edge: string, surface: string) => {
    r(0, 0, w, h, edge);
    r(3, 3, w - 6, h - 6, surface);
    r(4, 3, w - 8, 2, "#dfc99a");
  };
  if (id === "rug") {
    panel("#405c58", "#66847a");
    r(8, 8, w - 16, h - 16, "#4d6d64");
    for (let y = 16; y < h - 12; y += 16) {
      r(11, y, 3, 5, "#b4b894");
      r(w - 14, y, 3, 5, "#b4b894");
    }
  } else if (id.startsWith("desk-")) {
    panel("#574838", "#b99a70");
    for (let y = 10; y < h - 3; y += 12) r(6, y, w - 12, 1, "#aa8961");
    if (role === "builder") {
      r(23, 7, 40, 7, "#293f41");
      r(26, 7, 34, 3, "#8ac3bf");
      r(38, 14, 10, 6, "#3d5250");
      r(24, 24, 36, 12, "#4b625c");
      for (let y = 26; y < 34; y += 3) r(27, y, 29, 1, "#abc0a9");
      r(65, 25, 6, 9, "#dad9b5");
    } else {
      r(12, 12, 34, 25, "#f0dfb6");
      r(28, 13, 2, 23, "#bba67b");
      for (let y = 18; y < 33; y += 5) r(15, y, 10, 1, "#b7a782");
      r(55, 13, 3, 22, role === "reviewer" ? "#a985b0" : "#527f76");
    }
    r(w - 17, 8, 10, 10, "#e8ddba");
    r(w - 15, 10, 6, 6, "#674d38");
  } else if (id.startsWith("plant-")) {
    r(6, 12, w - 12, h - 20, "#a77654");
    r(9, 15, w - 18, h - 26, "#513f33");
    r(11, 3, 7, h - 8, "#50785a");
    r(2, 13, w - 4, 9, "#6c9465");
    r(4, 6, 9, 10, "#95b77c");
    r(17, 24, 9, 10, "#82a66b");
    r(11, 17, 7, 8, "#b4ca88");
  } else if (id === "bed") {
    panel("#75593e", "#e4d8b7");
    r(8, 8, 33, h - 16, "#f8efd5");
    r(11, 11, 27, h - 22, "#e9e0c4");
    r(48, 5, w - 53, h - 10, "#638e94");
    r(50, 8, 5, h - 16, "#a5c9be");
    r(w - 12, 7, 3, h - 14, "#4b727f");
  } else if (id === "bookshelf") {
    panel("#514637", "#9b805a");
    for (let x = 8; x < w - 10; x += 9) {
      r(
        x,
        8,
        6,
        h - 16,
        ["#849c7a", "#c68e70", "#d5bf8c", "#829ca4"][Math.floor(x / 9) % 4],
      );
      r(x + 1, 11, 4, 2, "#e3d7b3");
    }
  } else if (id === "coffee") {
    panel("#65513d", "#bca17a");
    r(w - 34, 8, 25, 32, "#344c49");
    r(w - 30, 12, 17, 17, "#788d7b");
    r(w - 26, 16, 9, 9, "#273d38");
    r(w - 27, 33, 12, 4, "#d9cfad");
    for (const x of [12, 32]) {
      r(x, 17, 12, 12, "#eee2bf");
      r(x + 3, 20, 6, 6, "#70523b");
    }
    r(10, h - 17, w - 20, 7, "#8eab95");
  } else if (id === "tool-rack") {
    panel("#4d5142", "#929371");
    for (let x = 9; x < w - 12; x += 15) {
      r(x, 9, 4, 23, "#5b634e");
      r(x - 3, 11, 10, 5, "#d0c9a1");
    }
  } else if (id === "board") {
    panel("#6e583d", "#3e5e55");
    for (let x = 16; x < w - 25; x += 40) {
      r(x, 12, 28, 27, "#dfd1aa");
      r(x + 10, 10, 5, 5, "#c98564");
      r(x + 5, 21, 17, 2, "#a9a383");
      r(x + 5, 27, 12, 2, "#a9a383");
    }
  }
  return pixels;
}
