import {
  furnitureSize,
  type Furniture,
  type RoomRotation,
} from "./room-layout";

export interface FurniturePixel {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}
// Facing-specific pixel drawings. Vertical features stay upright in side/back views.
export function furnitureView(
  item: Furniture,
  facing: RoomRotation,
  role?: string,
): FurniturePixel[] {
  const { width: w, height: h } = furnitureSize(item, facing);
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
  const side = facing === 90 || facing === 270,
    back = facing === 180;
  if (item.id.startsWith("desk-")) {
    r(5, h - 15, w - 10, 15, "#493525");
    r(9, h - 12, 5, 12, "#9a754c");
    r(w - 14, h - 12, 5, 12, "#9a754c");
    r(0, 6, w, h - 20, "#785536");
    r(3, 8, w - 6, h - 26, "#c39b65");
    r(5, 10, w - 10, 3, "#d6b07b");
    if (back) {
      r(3, h - 20, w - 6, 7, "#735136");
      r(10, h - 19, w - 20, 3, "#99704b");
    }
    if (role === "builder") {
      if (side) {
        const x = facing === 90 ? 3 : w - 12;
        r(x, 17, 9, 35, "#2c3e3c");
        r(x + (facing === 90 ? 5 : 1), 20, 3, 26, "#7caeaa");
        r(x - 2, 52, 13, 4, "#25312f");
        r(facing === 90 ? 17 : 5, 44, 22, 12, "#4f6860");
        r(facing === 90 ? 19 : 7, 46, 18, 3, "#a2beb0");
      } else {
        r(w / 2 - 21, 12, 42, 22, "#2c3b38");
        r(w / 2 - 17, 15, 34, 14, back ? "#4a5c54" : "#8ab4a7");
        r(w / 2 - 3, 34, 6, 5, "#35433b");
      }
    } else {
      r(8, side ? 24 : 12, side ? w - 16 : 30, side ? 24 : 12, "#ebd8a8");
      r(11, side ? 28 : 15, side ? w - 22 : 22, 2, "#ad996f");
      r(
        w - 15,
        side ? 53 : 12,
        8,
        9,
        role === "reviewer" ? "#8dba9c" : "#f0dfb6",
      );
    }
  } else if (item.id === "bookshelf") {
    r(0, 0, w, h, "#493c2c");
    r(4, 3, w - 8, h - 6, side ? "#876343" : "#96714d");
    if (back) {
      for (let x = 10; x < w - 5; x += 15) r(x, 5, 2, h - 10, "#705236");
    } else if (side) {
      r(facing === 90 ? 3 : w - 10, 3, 7, h - 6, "#b58d5c");
      for (let y = 15; y < h - 5; y += 25) {
        r(10, y, w - 16, 3, "#5b452e");
        r(13, y + 4, 4, 14, "#b79c74");
      }
    } else {
      for (let y = 6; y < h - 8; y += 16) {
        for (let x = 7; x < w - 7; x += 7)
          r(
            x,
            y,
            5,
            11,
            ["#9a8260", "#83a28a", "#c5aa7e"][Math.floor(x / 7) % 3],
          );
        r(3, y + 12, w - 6, 3, "#bd9564");
      }
    }
  } else if (item.id === "bed") {
    r(0, 0, w, h, "#785437");
    r(5, 4, w - 10, h - 8, "#d7c39c");
    const pillowX = side ? 9 : back ? w - 42 : 8,
      pillowY = side && facing === 270 ? h - 34 : 8;
    r(pillowX, pillowY, side ? w - 18 : 34, side ? 25 : h - 18, "#f5e9cb");
    if (side) {
      const y = facing === 90 ? 39 : 8;
      r(6, y, w - 12, h - 47, "#607f91");
      r(8, y + 3, w - 16, 4, "#9cb7bc");
      r(8, y + h - 56, w - 16, 4, "#446174");
    } else {
      r(back ? 6 : 48, 6, w - 54, h - 12, "#607f91");
      r(back ? 8 : 50, 8, w - 58, 4, "#9cb7bc");
    }
  } else if (item.id === "coffee") {
    r(2, side ? 8 : 25, w - 4, h - (side ? 8 : 25), "#765239");
    r(0, side ? 6 : 23, w, 7, "#c4a170");
    r(
      6,
      side ? 28 : 35,
      w - 12,
      h - (side ? 35 : 42),
      back ? "#6a4d36" : "#98724e",
    );
    if (back) {
      r(w - 28, 0, 22, 24, "#32423e");
      r(w - 25, 3, 16, 16, "#4b5e55");
    } else {
      const mx = side ? (facing === 90 ? 7 : w - 28) : w - 28;
      r(mx, side ? 13 : 0, 21, 25, "#30423f");
      r(mx + 3, side ? 16 : 3, 15, 10, "#83a6a0");
      r(mx + 6, side ? 29 : 16, 10, 5, "#e5d4aa");
      r(side ? w - 20 : 12, side ? 54 : 13, 10, 8, "#efdfb9");
    }
  } else if (item.id === "tool-rack") {
    r(0, 0, w, h, "#3e3b2e");
    r(4, 4, w - 8, h - 8, back ? "#5e5941" : "#787453");
    if (!back) {
      for (let i = 0; i < (side ? 5 : 7); i++) {
        const x = side ? w / 2 : 10 + i * 13,
          y = side ? 12 + i * 19 : 10;
        r(x, y, 3, 13, "#c4b98d");
        r(x - 3, y + 2, 9, 4, "#d5cba6");
      }
    }
  } else if (item.id.startsWith("plant-")) {
    const cx = w / 2;
    r(cx - 8, h - 16, 16, 15, "#a87650");
    r(cx - 10, h - 18, 20, 5, "#c39a70");
    r(cx - 2, 5, 4, h - 22, "#526f43");
    r(cx - 12, 7, 12, 8, "#839d65");
    r(cx + 1, 3, 12, 8, "#9cb77a");
    r(cx + 1, 15, 10, 7, "#708d55");
  } else if (item.id === "board") {
    r(0, 0, w, h, "#5c4731");
    r(4, 4, w - 8, h - 8, "#b99a65");
    r(8, 8, w - 16, h - 16, back ? "#766448" : "#465b4a");
    if (!back)
      for (let y = 15; y < h - 12; y += 18) {
        r(13, y, Math.min(28, w - 26), 9, "#e2d3a8");
      }
  }
  return pixels;
}
