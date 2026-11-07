import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";
import {
  furniture,
  furnitureBounds,
  placeFurniture,
  transformFurniturePoint,
  resizeFurniture,
  type RoomLayout,
} from "../shared/room-layout";
import { starterTeam } from "../shared/defaults";
import { officeLayout, previousCreativeCommonsLayout } from "../shared/office-layouts";
import { officeFixtures, roomDividers } from "../shared/office-rooms";
import { home, officePath, walkable } from "../shared/office-motion";
test("Creative Commons upgrades untouched layouts while preserving customized furniture", () => {
  for (const customized of [false, true]) {
    const directory = mkdtempSync(join(tmpdir(), "pixelcrew-commons-")), file = join(directory, "studio.sqlite");
    let store = new Store(file);
    try {
      const original = officeLayout("commons", store.team().agents, true);
      if (customized) original["desk-0"].x += 8;
      store.applyLayout("commons", original);
      store.db.prepare("DELETE FROM settings WHERE key='creative-commons-v2'").run();
      store.close(); store = new Store(file);
      assert.deepEqual(store.roomLayout(), customized ? original : officeLayout("commons", store.team().agents));
    } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
  }
});

test("Creative Commons v3 migrates an untouched old preset and keeps its undo layout", () => {
  const directory = mkdtempSync(join(tmpdir(), "pixelcrew-commons-v3-")), file = join(directory, "studio.sqlite");
  let store = new Store(file);
  try {
    const previous = previousCreativeCommonsLayout(store.team().agents);
    store.applyLayout("commons", previous);
    store.db.prepare("DELETE FROM settings WHERE key='creative-commons-v3'").run();
    store.close();
    store = new Store(file);
    assert.deepEqual(store.roomLayout(), officeLayout("commons", store.team().agents));
    assert.deepEqual(JSON.parse(store.db.prepare("SELECT value FROM settings WHERE key=?").get(`room-undo:${store.activeTeamId()}`)?.value as string), previous);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("office arrangement survives closing and reopening SQLite", () => {
  const directory = mkdtempSync(join(tmpdir(), "hearth-layout-"));
  const path = join(directory, "studio.sqlite");
  let store = new Store(path);
  try {
    const saved = store.saveRoomLayout({
      bed: { x: 88, y: 200, rotation: 90, scale: 1.25 },
      coffee: { x: 520, y: 248, width: 110, height: 80 },
      "desk-8": { x: 672, y: 416, rotation: 0 },
      "desk-4": { x: 176, y: 184, rotation: 90 },
      "bathroom-door": { x: 256, y: 32, width: 44, height: 56 },
      "window-0": { x: 96, y: 40, width: 72, height: 52 },
    });
    store.close();
    store = new Store(path);
    assert.deepEqual(store.roomLayout(), saved);
    assert.throws(
      () => store.saveRoomLayout({ unknown: { x: 1, y: 2 } }),
      /Unknown furniture/,
    );
    assert.throws(() =>
      store.saveRoomLayout({ bed: { x: 88, y: 280, rotation: 45 } }),
    );
    assert.deepEqual(store.roomLayout(), saved);
    store.saveRoomLayout({});
    assert.deepEqual(store.roomLayout(), {});
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("dragging a border resizes one dimension and corners resize both", () => {
  const item = furniture(starterTeam.agents).find(
    (item) => item.id === "coffee",
  )!;
  const saved = { x: 400, y: 200, rotation: 90 as const, scale: 1 };
  const east = resizeFurniture(item, saved, "e", 20, 0);
  const bounds = furnitureBounds(item, { coffee: east });
  assert.equal(bounds.width, 84);
  assert.equal(bounds.height, 90);
  assert.equal(east.width, 90);
  assert.equal(east.height, 84);
  const corner = resizeFurniture(item, saved, "se", 20, 30);
  assert.deepEqual(furnitureBounds(item, { coffee: corner }), {
    left: 400,
    top: 200,
    width: 84,
    height: 120,
  });
  const west = resizeFurniture(item, saved, "w", -20, 0);
  assert.equal(west.x, 380);
  assert.equal(
    furnitureBounds(item, { coffee: west }).left +
      furnitureBounds(item, { coffee: west }).width,
    464,
  );
});

test("item size changes transform points and remain within the room", () => {
  const item = furniture(starterTeam.agents).find(
    (item) => item.id === "coffee",
  )!;
  const layout: RoomLayout = {
    coffee: placeFurniture(item, 400, 200, 90, 1.5),
  };
  assert.deepEqual(furnitureBounds(item, layout), {
    left: 400,
    top: 200,
    width: 96,
    height: 135,
  });
  assert.deepEqual(
    transformFurniturePoint(item, layout, { x: item.x + 10, y: item.y + 20 }),
    { x: 466, y: 215 },
  );
  const rug = furniture(starterTeam.agents).find((item) => item.id === "rug")!;
  const resized = placeFurniture(rug, 650, 400, 0, 2);
  assert.equal(resized.scale, 1.25);
  const bounds = furnitureBounds(rug, { rug: resized });
  assert.ok(bounds.left + bounds.width <= 800);
  assert.ok(bounds.top + bounds.height <= 480);
});

test("quarter-turn rotation transforms artwork bounds, homes and navigation", () => {
  const agents = starterTeam.agents;
  const bed = furniture(agents).find((item) => item.id === "bed")!;
  const layout: RoomLayout = { bed: placeFurniture(bed, 80, 240, 90) };
  assert.deepEqual(furnitureBounds(bed, layout), {
    left: 80,
    top: 240,
    width: 54,
    height: 124,
  });
  assert.deepEqual(
    transformFurniturePoint(bed, layout, { x: bed.x, y: bed.y }),
    { x: 134, y: 240 },
  );
  const desk = furniture(agents).find(
    (item) => item.id === `desk-${agents[0].workstation}`,
  )!;
  layout[desk.id] = placeFurniture(desk, 320, 160, 90);
  assert.deepEqual(
    home(agents[0], layout),
    transformFurniturePoint(desk, layout, home(agents[0])),
  );
  const path = officePath(
    { x: 240, y: 240 },
    { x: 480, y: 360 },
    agents,
    layout,
  );
  assert.ok(path.length);
  assert.ok(path.every((point) => walkable(point, agents, layout)));
  assert.ok(placeFurniture(bed, 650, 400, 90).y + 124 <= 480);
});

test("crew work positions move off a customizable wall", () => {
  const agents = starterTeam.agents;
  const layout = officeLayout("commons", agents);
  const agent = agents[0];
  const originalHome = home(agent, layout);
  const wall = roomDividers.find((item) => item.id === "divider-commons-0")!;
  layout[wall.id] = placeFurniture(
    wall,
    originalHome.x - wall.width / 2,
    originalHome.y - 24,
    0,
    1,
    { width: wall.width, height: wall.height },
  );
  const safeHome = home(agent, layout);
  assert.notDeepEqual(safeHome, originalHome);
  assert.ok(walkable(safeHome, agents, layout));
});

test("crew work positions avoid movable windows and bathroom doors", () => {
  const agents = starterTeam.agents;
  const layout = officeLayout("workshop", agents);
  const agent = agents[0];
  const originalHome = home(agent, layout);
  const window = officeFixtures.find((item) => item.id === "window-0")!;
  layout[window.id] = placeFurniture(
    window,
    originalHome.x - window.width / 2,
    originalHome.y - 16,
    0,
    1,
    { width: window.width, height: window.height },
  );
  const safeHome = home(agent, layout);
  assert.notDeepEqual(safeHome, originalHome);
  assert.ok(walkable(safeHome, agents, layout));
});
