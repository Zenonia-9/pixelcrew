import { officeEntrance } from "../shared/office-entrance";
import { test } from "node:test";
import assert from "node:assert/strict";
import { starterTeam } from "../shared/defaults";
import { normalAgent, normalStation } from "../shared/normal-agent";
import { officeLayout } from "../shared/office-layouts";
import {
  activeDividers,
  officeRoomPlan,
  roomPlans,
} from "../shared/office-rooms";
import { home, officePath, walkable } from "../shared/office-motion";
import { officeDesign } from "../shared/office-designs";
import { furniture, furnitureBounds } from "../shared/room-layout";

test("legacy and unknown backgrounds still resolve to Timber", () => {
  assert.equal(officeDesign().id, "timber");
  assert.equal(officeDesign("unknown").id, "timber");
});

test("room plans keep all twelve workstation positions clear and reachable", () => {
  const agents = Array.from({ length: 12 }, (_, workstation) => ({
    ...starterTeam.agents[workstation % starterTeam.agents.length],
    id: `member-${workstation}`,
    workstation,
  }));
  for (const id of Object.keys(roomPlans)) {
    const layout = officeLayout(id, agents);
    const desks = furniture(agents).filter((item) =>
      item.id.startsWith("desk-"),
    );
    for (let index = 0; index < desks.length; index++) {
      const a = furnitureBounds(desks[index], layout);
      for (const other of desks.slice(index + 1)) {
        const b = furnitureBounds(other, layout);
        assert.ok(
          a.left + a.width <= b.left ||
            b.left + b.width <= a.left ||
            a.top + a.height <= b.top ||
            b.top + b.height <= a.top,
          `${id}: ${desks[index].id} and ${other.id} do not overlap`,
        );
      }
    }
    for (const agent of agents) {
      assert.ok(
        walkable(home(agent, layout), agents, layout),
        `${id}: station ${agent.workstation} has a clear chair`,
      );
      assert.ok(
        officePath(home(agent, layout), home(agents[0], layout), agents, layout)
          .length,
        `${id}: station ${agent.workstation} connects to the lead`,
      );
    }
  }
});

test("every room plan has connected desks and physically blocked partitions", () => {
  const agents = [
    ...starterTeam.agents,
    normalAgent(starterTeam.agents[0], normalStation(starterTeam.agents)),
  ];
  for (const id of Object.keys(roomPlans)) {
    const layout = officeLayout(id, starterTeam.agents);
    assert.ok(officeRoomPlan(layout));
    for (const divider of activeDividers(layout)) {
      const saved = layout[divider.id];
      assert.equal(
        walkable({ x: saved.x + 8, y: saved.y + 8 }, agents, layout),
        false,
        `${id}: partition blocks movement`,
      );
    }
    for (const agent of agents) {
      assert.ok(
        walkable(home(agent, layout), agents, layout),
        `${id}: ${agent.name}'s chair is clear`,
      );
      for (const colleague of agents) {
        const path = officePath(
          home(agent, layout),
          home(colleague, layout),
          agents,
          layout,
        );
        assert.ok(
          path.length,
          `${id}: ${agent.name} can reach ${colleague.name}`,
        );
        assert.ok(
          path.every((point) => walkable(point, agents, layout)),
          `${id}: routes use doorways`,
        );
      }
    }
  }
});

test("remodeled commons has a clear exterior entrance for small and large crews", () => {
  for(const size of [4,12]) {
    const team=Array.from({length:size},(_,workstation)=>({...starterTeam.agents[workstation%4],id:`crew-${workstation}`,workstation}));
    const members=size<12 ? [...team,normalAgent(team[0],normalStation(team))] : team;
    const layout=officeLayout("commons",team);
    assert.ok(walkable(officeEntrance.target,members,layout),"entrance threshold is clear");
    for(const member of members) {
      const route=officePath(home(member,layout),officeEntrance.target,members,layout);
      assert.ok(route.length,`${size} crew: ${member.id} reaches entrance`);
      assert.ok(Math.hypot(route.at(-1)!.x-officeEntrance.target.x,route.at(-1)!.y-officeEntrance.target.y)<12);
    }
  }
});
