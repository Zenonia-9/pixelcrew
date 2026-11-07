import { PNG } from "pngjs";
import { writeFileSync } from "node:fs";

// Eight directions and eight grounded steps per cycle. Original 32px pixel art with palette variants.
export function drawWalk(kind, colors, looks, source) {
  const sheet = new PNG({ width: 256, height: 256 });
  sheet.data.fill(0);
  const directions = [
    "down",
    "down-left",
    "left",
    "up-left",
    "up",
    "up-right",
    "right",
    "down-right",
  ];
  const rgba = (name) => {
    const hex = (colors[name] || name).slice(1);
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(255);
  };
  for (let direction = 0; direction < 8; direction++)
    for (let frame = 0; frame < 8; frame++) {
      const facing = directions[direction];
      const back = facing.startsWith("up"),
        side = facing === "left" || facing === "right";
      const left = facing.includes("left"),
        right = facing.includes("right");
      const compress = side ? 0.84 : direction % 2 ? 0.94 : 1;
      const stride = [0, 1, 2, 1, 0, -1, -2, -1][frame];
      const pixel = (x, y, color) => {
        if (x < 0 || x >= 32 || y < 0 || y >= 32) return;
        sheet.data.set(
          color,
          ((direction * 32 + y) * 256 + frame * 32 + x) * 4,
        );
      };
      // Start from the actual character, keeping all identifying accessories and proportions.
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++) {
          const at = (y * source.width + x) * 4;
          if (!source.data[at + 3]) continue;
          let color = Array.from(source.data.subarray(at, at + 4));
          const head = y >= 9 && y <= 17 && x >= 9 && x <= 24;
          if (
            (side || back || direction % 2) &&
            head &&
            !(kind === "atlas" && x >= 23)
          ) {
            const face =
              kind === "atlas"
                ? "brown"
                : kind === "pip"
                  ? "orange"
                  : kind === "mira"
                    ? "pink"
                    : "blue";
            color = rgba(face);
          }
          let yy = y;
          // Alternating grounded legs, with shoulders counter-swinging around a stable torso.
          if (y >= 26 && x >= 9 && x <= 24)
            yy = Math.min(30, y + Math.round((x < 17 ? stride : -stride) / 2));
          if (y >= 19 && y < 26 && (x < 11 || x > 23))
            yy += Math.round((x < 17 ? -stride : stride) / 2);
          const xx = Math.round(
            16 +
              (x - 16) * compress +
              (y < 19 ? (left ? -1 : right ? 1 : 0) : 0),
          );
          pixel(xx, yy, color);
        }
      const block = (x, y, w, h, c) => {
        for (let yy = y; yy < y + h; yy++)
          for (let xx = x; xx < x + w; xx++) pixel(xx, yy, rgba(c));
      };
      if (side) {
        const eye = left ? 10 : 22;
        if (kind === "bolt" || kind === "nova") {
          block(left ? 9 : 17, 9, 7, 6, "black");
          block(eye, 10, 2, 2, "white");
        } else {
          if (kind === "atlas") block(left ? 8 : 18, 10, 7, 7, "cream");
          if (kind === "pip") block(left ? 8 : 20, 14, 5, 4, "cream");
          block(eye, 11, 2, 3, "black");
          block(left ? 8 : 24, 15, 2, 2, kind === "atlas" ? "gold" : "black");
        }
      } else if (direction % 2) {
        if (!back) {
          const shift = left ? -2 : 2;
          if (kind === "bolt" || kind === "nova")
            block(10 + shift, 9, 12, 6, "black");
          if (kind === "atlas") {
            block(9 + shift, 10, 6, 6, "cream");
            block(17 + shift, 10, 6, 6, "cream");
          }
          block(
            12 + shift,
            11,
            2,
            3,
            kind === "bolt" || kind === "nova" ? "white" : "black",
          );
          block(
            20 + shift,
            11,
            2,
            3,
            kind === "bolt" || kind === "nova" ? "white" : "black",
          );
          block(16 + shift, 15, 2, 2, "gold");
        } else {
          block(
            left ? 10 : 22,
            11,
            2,
            2,
            kind === "bolt" || kind === "nova" ? "white" : "black",
          );
        }
      }
      // A blink completes the eight-frame idle-facing cycle without replacing the face design.
    }
  for (const look of looks) {
    const variant = new PNG({ width: sheet.width, height: sheet.height });
    sheet.data.copy(variant.data);
    const replacements = new Map(
      Object.entries(look.colors || {}).map(([key, value]) => [
        colors[key],
        value,
      ]),
    );
    for (let i = 0; i < variant.data.length; i += 4) {
      if (!variant.data[i + 3]) continue;
      const hex =
        "#" +
        Array.from(variant.data.subarray(i, i + 3))
          .map((v) => v.toString(16).padStart(2, "0"))
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
      `public/sprites/${kind}${look.id === "classic" ? "" : `-${look.id}`}-walk.png`,
      PNG.sync.write(variant),
    );
  }
}
