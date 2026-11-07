import { drawWalk } from "./draw-walk.mjs";
import looks from "../resources/character-looks.json" with { type: "json" };
import { PNG } from "pngjs";
import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("public/sprites", { recursive: true });
// Original grid-drawn artwork. All frames are exactly 32x32 with transparent alpha.
const colors = {
  outline: "#29283b",
  cream: "#f4ddb1",
  gold: "#e8af52",
  brown: "#957044",
  orange: "#d97942",
  light: "#edb86b",
  green: "#698963",
  blue: "#79bec2",
  darkblue: "#427988",
  purple: "#8e6ca9",
  pink: "#d8a6c3",
  white: "#f2edd5",
  black: "#29313a",
};
for (const kind of ["atlas", "pip", "bolt", "mira", "nova"]) {
  const png = new PNG({ width: 256, height: 32 });
  png.data.fill(0);
  for (let frame = 0; frame < 8; frame++) {
    const ox = frame * 32,
      dy = frame === 1 || frame === 3 ? -1 : 0;
    const rect = (x, y, w, h, c) => {
      const hex = (colors[c] || c).slice(1);
      for (let yy = y + dy; yy < y + dy + h; yy++)
        for (let xx = x; xx < x + w; xx++) {
          if (xx < 0 || xx >= 32 || yy < 0 || yy >= 32) continue;
          const i = (yy * 256 + xx + ox) * 4;
          png.data[i] = parseInt(hex.slice(0, 2), 16);
          png.data[i + 1] = parseInt(hex.slice(2, 4), 16);
          png.data[i + 2] = parseInt(hex.slice(4, 6), 16);
          png.data[i + 3] = 255;
        }
    };
    rect(8, 28, 16, 2, "outline");
    if (kind === "atlas") {
      rect(10, 12, 13, 15, "outline");
      rect(11, 14, 11, 12, "purple");
      rect(9, 19, 3, 7, "purple");
      rect(22, 19, 3, 7, "purple");
      rect(10, 9, 13, 10, "brown");
      rect(8, 8, 5, 9, "brown");
      rect(20, 8, 5, 9, "brown");
      rect(10, 10, 6, 6, "cream");
      rect(17, 10, 6, 6, "cream");
      rect(12, 12, 2, 3, "black");
      rect(19, 12, 2, 3, "black");
      rect(15, 15, 3, 3, "gold");
      rect(7, 7, 19, 2, "darkblue");
      rect(11, 4, 11, 3, "darkblue");
      rect(14, 1, 7, 3, "darkblue");
      rect(18, 4, 2, 2, "gold");
      rect(14, 21, 5, 2, "gold");
      rect(24, 12, 2, 15, "brown");
      rect(23, 10, 4, 4, "gold");
    } else if (kind === "pip") {
      rect(6, 18, 6, 8, "orange");
      rect(4, 17, 4, 5, "cream");
      rect(11, 17, 12, 11, "green");
      rect(10, 6, 14, 13, "orange");
      rect(9, 3, 5, 8, "orange");
      rect(21, 3, 5, 8, "orange");
      rect(10, 5, 2, 4, "pink");
      rect(23, 5, 2, 4, "pink");
      rect(11, 13, 5, 5, "cream");
      rect(19, 13, 5, 5, "cream");
      rect(13, 10, 2, 3, "black");
      rect(21, 10, 2, 3, "black");
      rect(16, 14, 4, 2, "black");
      rect(10, 18, 15, 3, "gold");
      rect(12, 27, 4, 2, "brown");
      rect(20, 27, 4, 2, "brown");
      rect(19, 22, 5, 5, "brown");
      rect(24, 20, 3, 5, "light");
    } else if (kind === "bolt" || kind === "nova") {
      rect(10, 17, 14, 11, "darkblue");
      rect(12, 19, 10, 7, "blue");
      rect(14, 21, 5, 3, "gold");
      rect(8, 6, 18, 12, "darkblue");
      rect(10, 7, 14, 9, "blue");
      rect(11, 9, 12, 5, "black");
      rect(12, 10, 3, 2, "white");
      rect(20, 10, 2, 2, "white");
      rect(16, 3, 2, 4, "brown");
      rect(15, 1, 4, 3, "gold");
      rect(6, 19, 3, 7, "blue");
      rect(25, 19, 3, 7, "blue");
      rect(10, 28, 5, 2, "brown");
      rect(20, 28, 5, 2, "brown");
      rect(15, 15, 5, 1, "white");
      if (kind === "nova") {
        rect(10, 7, 14, 2, "purple");
        rect(12, 19, 10, 7, "purple");
        rect(14, 21, 6, 2, "cream");
        rect(5, 7, 3, 9, "purple");
        rect(26, 7, 3, 9, "purple");
        rect(15, 1, 4, 3, "pink");
      }
    } else {
      rect(9, 18, 15, 10, "purple");
      rect(10, 6, 14, 13, "pink");
      rect(9, 2, 5, 8, "pink");
      rect(20, 2, 5, 8, "pink");
      rect(10, 4, 2, 4, "purple");
      rect(22, 4, 2, 4, "purple");
      rect(12, 11, 2, 3, "black");
      rect(20, 11, 2, 3, "black");
      rect(16, 14, 3, 2, "purple");
      rect(13, 16, 7, 2, "cream");
      rect(8, 18, 17, 3, "darkblue");
      rect(16, 19, 3, 5, "gold");
      rect(25, 21, 4, 6, "pink");
      rect(27, 18, 3, 4, "pink");
      rect(9, 27, 5, 2, "darkblue");
      rect(20, 27, 5, 2, "darkblue");
      rect(4, 21, 5, 5, "green");
      rect(5, 19, 3, 3, "green");
    }
    if (frame === 2 || frame === 3) {
      rect(8, 24, 15, 3, "brown");
      rect(10, 22, 10, 2, "cream");
      rect(frame === 2 ? 19 : 21, 20, 3, 3, "gold");
    }
    if (frame === 4) {
      rect(24, 8, 3, 7, "gold");
      rect(24, 17, 3, 2, "gold");
    }
    if (frame === 5) {
      rect(4, 5, 2, 2, "gold");
      rect(27, 3, 2, 2, "gold");
      rect(2, 12, 2, 2, "white");
    }
    if (frame === 6) {
      rect(10, 10, 5, 1, "black");
      rect(19, 10, 5, 1, "black");
    }
    if (frame === 7) {
      rect(25, 3, 4, 1, "cream");
      rect(26, 5, 3, 1, "cream");
      rect(25, 7, 4, 1, "cream");
    }
  }
  writeFileSync(`public/sprites/${kind}.png`, PNG.sync.write(png));
  drawWalk(kind, colors, looks, png);
  // Separate cosmetic poses leave runtime animation sheets unchanged.
  const life = new PNG({ width: 192, height: 32 });
  life.data.fill(0);
  for (let pose = 0; pose < 6; pose++) {
    const lean = pose === 3 ? -1 : pose === 4 ? 1 : 0;
    const pixel = (x, y, color) => {
      if (x < 0 || x >= 32 || y < 0 || y >= 32) return;
      const hex = (colors[color] || color).slice(1);
      const at = (y * 192 + pose * 32 + x) * 4;
      life.data.set(
        [
          parseInt(hex.slice(0, 2), 16),
          parseInt(hex.slice(2, 4), 16),
          parseInt(hex.slice(4, 6), 16),
          255,
        ],
        at,
      );
    };
    const block = (x, y, w, h, color) => {
      for (let row = y; row < y + h; row++)
        for (let col = x; col < x + w; col++) pixel(col + lean, row, color);
    };
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const from = (y * 256 + x) * 4;
        if (!png.data[from + 3]) continue;
        if (
          pose >= 1 &&
          pose <= 4 &&
          ((y >= 18 && (x < 11 || x > 23)) ||
            (kind === "atlas" && x >= 24 && y >= 10))
        )
          continue;
        const dx = x + (y < 25 ? lean : 0);
        if (dx < 0 || dx >= 32) continue;
        life.data.set(
          png.data.subarray(from, from + 4),
          (y * 192 + pose * 32 + dx) * 4,
        );
      }
    if (pose === 0) {
      const eyes =
        kind === "atlas"
          ? [
              [12, 12],
              [19, 12],
            ]
          : kind === "pip"
            ? [
                [13, 10],
                [21, 10],
              ]
            : kind === "bolt"
              ? [
                  [12, 10],
                  [20, 10],
                ]
              : [
                  [12, 11],
                  [20, 11],
                ];
      const face =
        kind === "atlas"
          ? "cream"
          : kind === "pip"
            ? "orange"
            : kind === "bolt"
              ? "black"
              : "pink";
      for (const [x, y] of eyes) {
        block(x, y, 3, 3, face);
        block(x, y + 1, 3, 1, kind === "bolt" ? "blue" : "black");
      }
    }
    if (pose >= 1 && pose <= 4) {
      const sleeve =
        kind === "atlas" || kind === "mira"
          ? "purple"
          : kind === "bolt"
            ? "darkblue"
            : "green";
      const hand =
        kind === "atlas"
          ? "brown"
          : kind === "mira"
            ? "pink"
            : kind === "bolt"
              ? "blue"
              : "light";
      if (pose === 1) {
        block(5, 18, 6, 3, sleeve);
        block(24, 18, 6, 3, sleeve);
        block(3, 17, 3, 4, hand);
        block(29, 17, 3, 4, hand);
      } else {
        block(7, 12, 4, 8, sleeve);
        block(23, 12, 4, 8, sleeve);
        block(6, 6, 3, 8, hand);
        block(25, 6, 3, 8, hand);
        block(7, 4, 5, 3, hand);
        block(22, 4, 5, 3, hand);
      }
    }
  }
  writeFileSync(`public/sprites/${kind}-life.png`, PNG.sync.write(life));
  for (const look of looks.filter((look) => look.id !== "classic")) {
    const replacements = new Map(
      Object.entries(look.colors).map(([key, value]) => [colors[key], value]),
    );
    for (const [source, suffix] of [
      [png, ""],
      [life, "-life"],
    ]) {
      const variant = new PNG({ width: source.width, height: source.height });
      source.data.copy(variant.data);
      for (let i = 0; i < variant.data.length; i += 4) {
        if (!variant.data[i + 3]) continue;
        const hex =
          "#" +
          Array.from(variant.data.subarray(i, i + 3))
            .map((value) => value.toString(16).padStart(2, "0"))
            .join("");
        const replacement = replacements.get(hex);
        if (replacement)
          for (let channel = 0; channel < 3; channel++)
            variant.data[i + channel] = parseInt(
              replacement.slice(1 + channel * 2, 3 + channel * 2),
              16,
            );
      }
      writeFileSync(
        `public/sprites/${kind}-${look.id}${suffix}.png`,
        PNG.sync.write(variant),
      );
    }
  }
}
const tile = new PNG({ width: 48, height: 16 });
for (let y = 0; y < 16; y++)
  for (let x = 0; x < 48; x++) {
    const i = (y * 48 + x) * 4;
    let c =
      x < 16
        ? y === 15 || x === 0
          ? [71, 57, 46]
          : [107 + (x % 4), 80 + (y % 3), 55]
        : x < 32
          ? x % 16 === 0 || y === 15
            ? [52, 62, 56]
            : [67, 80, 68]
          : [104, 84, 60];
    tile.data.set([...c, 255], i);
  }
writeFileSync("public/sprites/tiles.png", PNG.sync.write(tile));
writeFileSync(
  "public/sprites/manifest.json",
  JSON.stringify(
    {
      frameWidth: 32,
      frameHeight: 32,
      animations: {
        idle: [0, 1],
        planning: [2, 3],
        working: [2, 3],
        approval: [4],
        completed: [5],
        failed: [6],
        interrupted: [6],
        waiting: [7],
      },
      characters: ["atlas", "pip", "bolt", "mira", "nova"],
      looks: looks.map(({ id, name }) => ({ id, name })),
      walkSheet: { suffix: "-walk", directions: ["down", "down-left", "left", "up-left", "up", "up-right", "right", "down-right"], framesPerDirection: 8 },
      idleSheet: {
        suffix: "-life",
        frameCount: 6,
        sleeping: [0],
        stretching: [1, 2, 3, 2, 4, 2, 1, 5],
      },
    },
    null,
    2,
  ),
);
console.log(
  "Drew five original characters with six premade looks and matching animation sheets.",
);
