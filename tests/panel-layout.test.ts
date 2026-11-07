import test from "node:test";
import assert from "node:assert/strict";
import { sidebarSize, profileSize } from "../shared/panel-layout";

test("narrow sidebar snaps to an icon rail and expanded sizes stay bounded", () => {
  assert.equal(sidebarSize(100), 68);
  assert.equal(sidebarSize(199), 68);
  assert.equal(sidebarSize(200), 200);
  assert.equal(sidebarSize(316), 316);
  assert.equal(sidebarSize(900), 420);
  assert.equal(sidebarSize(NaN), 260);
});
test("chat resizing uses the available workspace without a fixed or percentage cap", () => {
  assert.equal(profileSize(900, 1200), 900);
  assert.equal(profileSize(1100, 1200), 1100);
  assert.equal(profileSize(500, 700), 500);
  assert.equal(profileSize(100, 1000), 360);
  assert.equal(profileSize(320, 1000), 360);
  assert.equal(profileSize(2000, 1000), 993);
  assert.equal(profileSize(-50, 1000), 360);
  assert.equal(profileSize(400, 5), 0);
});
