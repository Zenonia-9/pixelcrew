import test from "node:test";
import assert from "node:assert/strict";
import { officeInteractions } from "../shared/office-interactions";
import { starterTeam } from "../shared/defaults";
import { home, officePath } from "../shared/office-motion";

test("bathroom, bookshelf, both windows and every plant have reachable activity targets", () => {
  const agents = starterTeam.agents;
  const interactions = officeInteractions(agents, {});
  assert.equal(interactions.length, 8);
  assert.equal(
    interactions.filter((item) => item.activity === "plants").length,
    4,
  );
  for (const item of interactions) {
    assert.ok(item.label);
    assert.ok(officePath(home(agents[0]), item.target, agents).length, item.id);
  }
});
test("click targets follow moved and rotated furniture", () => {
  const interactions = officeInteractions(starterTeam.agents, {
    bookshelf: { x: 240, y: 160, rotation: 90 },
    "plant-0": { x: 80, y: 280, rotation: 180 },
  });
  const shelf = interactions.find((item) => item.id === "bookshelf")!;
  assert.deepEqual(shelf.bounds, {
    left: 240,
    top: 160,
    width: 43,
    height: 115,
  });
  assert.deepEqual(shelf.target, { x: 254, y: 306 });
  const plants = interactions.filter((item) => item.activity === "plants");
  assert.notDeepEqual(plants[0].target, plants[1].target);
});

test("bathroom and window activity targets follow movable wall fixtures", () => {
  const layout = {
    "bathroom-door": { x: 300, y: 160, width: 50, height: 60 },
    "window-0": { x: 100, y: 200, width: 80, height: 60 },
  };
  const interactions = officeInteractions(starterTeam.agents, layout);
  assert.deepEqual(interactions.find((item) => item.id === "restroom")?.bounds, {
    left: 300,
    top: 160,
    width: 50,
    height: 60,
  });
  assert.deepEqual(interactions.find((item) => item.id === "restroom")?.target, {
    x: 325,
    y: 247,
  });
  assert.deepEqual(interactions.find((item) => item.id === "window-0")?.bounds, {
    left: 100,
    top: 200,
    width: 80,
    height: 60,
  });
  assert.deepEqual(interactions.find((item) => item.id === "window-0")?.target, {
    x: 140,
    y: 293,
  });
});
