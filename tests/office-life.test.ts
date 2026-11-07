import { test } from "node:test";
import assert from "node:assert/strict";
import {
  idleActivities,
  idleDelay,
  isOfficeBusy,
  officeRunIndicator,
  updateJourneyClock,
  activityRemainingMs,
  journeyLabel,
  type JourneyClock,
} from "../shared/office-life";
import { home, officePath, walkable } from "../shared/office-motion";
import { starterTeam } from "../shared/defaults";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const { PNG } = createRequire(import.meta.url)("pngjs") as {
  PNG: {
    sync: {
      read(bytes: Buffer): { width: number; height: number; data: Buffer };
    };
  };
};

test("idle activities cover requested breaks and all destinations remain reachable", () => {
  assert.equal(new Set(idleActivities.map((a) => a.id)).size, 8);
  for (const member of starterTeam.agents)
    for (const activity of idleActivities) {
      const route = officePath(
        home(member),
        activity.target,
        starterTeam.agents,
      );
      assert.ok(route.length, `${member.name} can reach ${activity.id}`);
      assert.ok(route.every((point) => walkable(point, starterTeam.agents)));
      assert.ok(
        officePath(route.at(-1)!, home(member), starterTeam.agents).length,
      );
      assert.ok(activity.frames.every((frame) => frame >= 0 && frame < 8));
    }
});
test("decorative activity cadence is bounded and active task states suppress breaks", () => {
  assert.equal(idleDelay(0), 60000);
  assert.equal(idleDelay(1), 100000);
  for (const state of ["queued", "running", "approval"])
    assert.equal(isOfficeBusy(state), true);
  for (const state of [
    undefined,
    "completed",
    "failed",
    "cancelled",
    "interrupted",
  ])
    assert.equal(isOfficeBusy(state), false);
});
test("office run indicators disappear when tours and tasks finish", () => {
  assert.equal(officeRunIndicator({ demo: true, status: "running" }), "simulated");
  assert.equal(officeRunIndicator({ demo: false, status: "approval" }), "live");
  for (const status of ["completed", "failed", "interrupted", "cancelled"])
    assert.equal(officeRunIndicator({ demo: true, status }), undefined);
  assert.equal(officeRunIndicator(undefined), undefined);
});

test("a long walk still gets a full watering animation after arrival", () => {
  const watering = idleActivities.find((activity) => activity.id === "plants")!;
  const walking: JourneyClock = {
    phase: "walking",
    walkingStartedAt: 0,
    activityDurationMs: watering.duration,
  };
  assert.equal(
    activityRemainingMs(walking, 60000),
    12000,
    "walking consumes no activity time",
  );
  assert.equal(journeyLabel(walking, 60000), "Walking · 60s");
  const arrived = updateJourneyClock(walking, true, 60000);
  assert.equal(arrived.phase, "activity");
  assert.equal(arrived.activityStartedAt, 60000);
  assert.equal(journeyLabel(arrived, 60000), "Doing · 12s left");
  assert.equal(activityRemainingMs(arrived, 66000), 6000);
  assert.equal(activityRemainingMs(arrived, 72000), 0);
  assert.equal(
    updateJourneyClock(arrived, true, 66000).activityStartedAt,
    60000,
    "arrival does not restart a running activity",
  );
});

test("each character has separate original sleeping and stretching pixel poses", () => {
  for (const name of ["atlas", "pip", "bolt", "mira"]) {
    const sheet = PNG.sync.read(
      readFileSync(`public/sprites/${name}-life.png`),
    );
    assert.equal(sheet.width, 6 * 32);
    assert.equal(sheet.height, 32);
    const frames = Array.from({ length: 6 }, (_, frame) =>
      Buffer.concat(
        Array.from({ length: 32 }, (_, row) =>
          sheet.data.subarray(
            (row * sheet.width + frame * 32) * 4,
            (row * sheet.width + frame * 32 + 32) * 4,
          ),
        ),
      ).toString("base64"),
    );
    assert.equal(
      new Set(frames).size,
      6,
      `${name} poses should be visually distinct`,
    );
    assert.ok(
      sheet.data.some((alpha, index) => index % 4 === 3 && alpha === 0),
    );
  }
});
