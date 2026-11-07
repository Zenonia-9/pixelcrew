import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAccountUsage,
  usageWindowLabel,
} from "../shared/account-usage";
import { CodexRuntime } from "../server/runtime";

test("runtime catalog disconnection is separate from forgetting saved account credentials", async () => {
  const runtime = new CodexRuntime(false, "C:/app/accounts/test");
  runtime.connect = async () => {};
  const calls: unknown[] = [];
  runtime.request = async (method, params) => {
    calls.push([method, params]);
    return { authUrl: "https://auth.openai.com/test" };
  };
  assert.deepEqual(await runtime.login(), { authUrl: "https://auth.openai.com/test" });
  runtime.status.authenticated = true;
  runtime.status.account = "test@example.com";
  await runtime.logout();
  assert.equal(runtime.status.authenticated, false);
  assert.equal(runtime.status.account, undefined);
  assert.deepEqual(calls, [["account/login/start", { type: "chatgpt" }]]);
  const desktop = new CodexRuntime();
  await assert.rejects(desktop.login(), /Add an app account/);
  await desktop.logout();
  await assert.rejects(desktop.connect(), /disconnected/);
  runtime.active.set("test", {} as any);
  await assert.rejects(runtime.logout(), /active work/);
  runtime.active.clear();
  runtime.request = async () => ({});
  await assert.rejects(runtime.login(), /sign-in link/);
});

test("account usage prefers named buckets and preserves unknown windows", () => {
  const result = normalizeAccountUsage({
    rateLimits: { primary: { usedPercent: 99 } },
    rateLimitsByLimitId: {
      codex: {
        primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 123 },
        secondary: { usedPercent: 8, windowDurationMins: 10080 },
      },
      other: { limitName: "Other models", primary: null },
    },
  });
  assert.deepEqual(
    result[0].windows.map((w) => w.remainingPercent),
    [75, 92],
  );
  assert.equal(result[1].label, "Other models");
  assert.deepEqual(result[1].windows, []);
  assert.equal(usageWindowLabel(300), "5h");
  assert.equal(usageWindowLabel(10080), "Weekly");
  assert.deepEqual(normalizeAccountUsage(null), []);
  assert.equal(
    normalizeAccountUsage({ rateLimits: { primary: { usedPercent: 110 } } })[0]
      .windows[0].remainingPercent,
    0,
  );
});

test("runtime reads limits and reports failures without inventing remaining usage", async () => {
  const runtime = new CodexRuntime();
  runtime.request = async (method) => {
    assert.equal(method, "account/rateLimits/read");
    return { rateLimits: { primary: { usedPercent: 12 } } };
  };
  await runtime.refreshUsage();
  assert.equal(runtime.status.usage?.[0].windows[0].remainingPercent, 88);
  assert.ok(runtime.status.usageUpdatedAt);
  runtime.request = async () => {
    throw Error("Offline");
  };
  await runtime.refreshUsage();
  assert.equal(runtime.status.usageError, "Offline");
});

test("sparse rate-limit notifications refetch both authoritative windows", async () => {
  const runtime = new CodexRuntime();
  runtime.request = async () => ({ rateLimits: { primary: { usedPercent: 5, windowDurationMins: 300 }, secondary: { usedPercent: 31, windowDurationMins: 10080 } } });
  (runtime as any).receive({ method: "account/rateLimits/updated", params: { rateLimits: { primary: { usedPercent: 5 } } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(runtime.status.usage?.[0].windows.map(window => window.remainingPercent), [95, 69]);
});
