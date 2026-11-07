import { test } from "node:test";
import assert from "node:assert/strict";
import {
  officePath,
  walkable,
  advancePath,
  home,
} from "../shared/office-motion";
import { starterTeam } from "../shared/defaults";

test("every starter can reach the lounge and visit every other desk without crossing furniture", () => {
  const agents = starterTeam.agents;
  for (const a of agents) {
    const destinations = [
      { x: 208, y: 336 },
      ...agents
        .filter((b) => b.id !== a.id)
        .map((b) => ({
          x: home(b).x + (home(b).x > 352 ? -64 : 64),
          y: home(b).y,
        })),
    ];
    for (const target of destinations) {
      const route = officePath(home(a), target, agents);
      assert.ok(route.length, `${a.name} has a route`);
      assert.ok(route.every((p) => walkable(p, agents)));
      const back = officePath(route.at(-1)!, home(a), agents);
      assert.ok(back.length, `${a.name} can return`);
    }
  }
});

test("movement advances at bounded speed and stops at the destination", () => {
  const route = [
    { x: 16, y: 0 },
    { x: 16, y: 16 },
  ];
  const step = advancePath({ x: 0, y: 0 }, route, 8);
  assert.deepEqual(step.position, { x: 8, y: 0 });
  assert.equal(route.length, 2, "input is not mutated");
  const end = advancePath(step.position, step.route, 100);
  assert.deepEqual(end, { position: { x: 16, y: 16 }, route: [] });
});
