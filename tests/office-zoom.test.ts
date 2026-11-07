import test from "node:test";
import assert from "node:assert/strict";
import { stepOfficeZoom, fitOfficeZoom } from "../shared/office-zoom";

test("office zoom changes by exactly one tenth without floating point drift", () => {
  let zoom = 1;
  for (const expected of [1.1, 1.2, 1.3, 1.4, 1.5]) {
    zoom = stepOfficeZoom(zoom, 1);
    assert.equal(zoom, expected);
  }
  assert.equal(stepOfficeZoom(zoom, -1), 1.4);
  assert.equal(stepOfficeZoom(0.5, -1), 0.5);
  assert.equal(stepOfficeZoom(2, 1), 2);
});

test("fit uses tenth steps within the supported zoom range", () => {
  assert.equal(fitOfficeZoom(1000, 600), 1.1);
  assert.equal(fitOfficeZoom(832, 512), 1);
  assert.equal(fitOfficeZoom(100, 100), 0.5);
  assert.equal(fitOfficeZoom(3000, 2000), 2);
});
