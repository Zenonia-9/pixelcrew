import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  walkDirection,
  walkDirections,
  walkFrames,
} from "../shared/office-walk";
import {
  characterKinds,
  characterLooks,
  walkSpriteAsset,
} from "../shared/character-assets";
import { topDownFurniture } from "../shared/top-down-furniture";
import { furniture } from "../shared/room-layout";
import { starterTeam } from "../shared/defaults";
const { PNG } = createRequire(import.meta.url)("pngjs");

test("walk direction follows vertical, horizontal and diagonal path segments", () => {
  const origin = { x: 120, y: 90 };
  for (const [x, y, expected] of [
    [120, 20, "up"],
    [120, 180, "down"],
    [20, 90, "left"],
    [180, 90, "right"],
    [125, 140, "down"],
    [20, 95, "left"],
  ] as const)
    assert.equal(walkDirection(origin, { x, y }), expected);
  assert.equal(walkDirection(origin, origin, "up"), "up");
});
test("every character outfit has transparent 32px directional walk frames", () => {
  for (const kind of characterKinds)
    for (const look of characterLooks) {
      const asset = walkSpriteAsset({ sprite: kind.id, look: look.id });
      const sheet = PNG.sync.read(
        readFileSync(new URL(`../public${asset}`, import.meta.url)),
      );
      assert.equal(sheet.width, 256);
      assert.equal(sheet.height, 256);
      const directions = new Set();
      for (let row = 0; row < walkDirections.length; row++) {
        const steps = new Set();
        for (let col = 0; col < walkFrames; col++) {
          const bytes = Buffer.alloc(32 * 32 * 4);
          for (let y = 0; y < 32; y++)
            sheet.data.copy(
              bytes,
              y * 128,
              ((row * 32 + y) * 256 + col * 32) * 4,
              ((row * 32 + y) * 256 + col * 32 + 32) * 4,
            );
          assert.ok(
            bytes.some((v, i) => i % 4 === 3 && v === 255),
            `${asset}: visible frame`,
          );
          assert.equal(bytes[3], 0, `${asset}: transparent frame corner`);
          steps.add(createHash("sha256").update(bytes).digest("hex"));
        }
        assert.ok(steps.size >= 3, `${asset}: distinct walking steps`);
        directions.add([...steps].join(":"));
      }
      assert.equal(directions.size, 8, `${asset}: distinct directions`);
    }
});

test("overhead furniture art fits saved layout footprints", () => {
  for (const item of furniture(starterTeam.agents)) {
    const pixels = topDownFurniture(item, "builder");
    assert.ok(pixels.length, item.id);
    for (const pixel of pixels) {
      assert.ok(pixel.x >= 0 && pixel.y >= 0, item.id);
      assert.ok(pixel.width > 0 && pixel.height > 0, item.id);
      assert.ok(pixel.x + pixel.width <= item.width, item.id);
      assert.ok(pixel.y + pixel.height <= item.height, item.id);
    }
  }
});

test("front walking poses retain the canonical character silhouette and palette", () => {
  for (const kind of characterKinds) {
    const source=PNG.sync.read(readFileSync(new URL(`../public/sprites/${kind.id}.png`,import.meta.url)));
    const walk=PNG.sync.read(readFileSync(new URL(`../public${walkSpriteAsset({sprite:kind.id})}`,import.meta.url)));
    for(let y=0;y<32;y++) for(let x=0;x<32;x++) {
      const at=(y*256+x)*4;
      assert.deepEqual(walk.data.subarray(at,at+4),source.data.subarray(at,at+4),`${kind.id}: front pose ${x},${y}`);
    }
  }
});
