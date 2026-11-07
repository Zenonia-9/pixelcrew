import test from "node:test";
import assert from "node:assert/strict";
import { chromeTabs } from "../server/chrome-tabs";

test("Chrome tab selection uses native tab entries and excludes web page tabs", () => {
  assert.deepEqual(chromeTabs(`0 window Chrome
  1 tab list
    2 tab (selected) PixelCrew
    3 tab item ChatGPT
  4 button New tab
  5 document PixelCrew
    6 tab General`), [
    { elementIndex: 2, description: "(selected) PixelCrew" },
    { elementIndex: 3, description: "ChatGPT" },
  ]);
  assert.deepEqual(chromeTabs("0 window Chrome\n  1 button Search tabs"), []);
});
