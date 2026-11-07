import { test } from "node:test";
import { usageLimitMessage } from "../shared/usage-limit";
import assert from "node:assert/strict";
test("usage limits preserve the native failure and replace the generic chat error", () => {
  const turn = normalizeTurn({ id: "limited", status: "failed", error: { message: "You've hit your usage limit." }, items: [] }, { status: "inProgress" });
  assert.equal(turn.status, "failed");
  assert.equal(turn.error, "You've hit your usage limit.");
  const html = renderToStaticMarkup(createElement(Turn, { turn, chatId: "chat" }));
  assert.ok(!html.includes("usage-limit-notice"));
  const notice = renderToStaticMarkup(createElement(UsageLimitNotice, { error: turn.error }));
  assert.ok(notice.includes("chat-system-message"));
  assert.ok(notice.includes("Upgrade your plan or add credits"));
  assert.ok(!html.includes("This turn failed."));
  assert.ok(usageLimitMessage.includes("try again later"));
});
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync, truncateSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  normalizeTurn,
  recordedUsage,
  tokens,
  usageDelta,
} from "../server/chat-history";
import { Markdown, durationLabel, Turn, UserMessage, UsageLimitNotice } from "../src/ChatThread";
import { NativeChatTurn } from "../src/GroupChat";
import { starterTeam } from "../shared/defaults";
import {
  localImageAttachments,
  localImagePath,
} from "../shared/chat-presentation";

test("local reply images use chat-scoped URLs and images open in an in-app preview", () => {
  const path = "C:/Work/My Project/image (1).png";
  const text = `![Result](<${path}>)`;
  assert.equal(localImageAttachments(text)[0].path, path);
  assert.equal(
    localImageAttachments("![Remote](https://example.com/a.png)").length,
    0,
  );
  const html = renderToStaticMarkup(
    createElement(Markdown, { text, chatId: "chat-1" }),
  );
  assert.ok(html.includes("/api/chats/chat-1/attachment?path="));
  assert.ok(html.includes('aria-label="Preview image: Result"'));
  assert.ok(!html.includes('src="C:'));
  const user = renderToStaticMarkup(
    createElement(UserMessage, {
      text: "Look",
      chatId: "chat-1",
      attachments: [{ path, name: "image.png", kind: "image" }],
    }),
  );
  assert.ok(user.includes('aria-label="Preview image: image.png"'));
  assert.ok(!user.includes('target="_blank"'));
  assert.ok(
    user.indexOf('class="chat-attachments"') <
      user.indexOf('class="chat-message user"'),
  );
  assert.match(user, /<\/div><div class="chat-message user">/);
});

test("running turns interleave every progress message with compact tool groups in time order", () => {
  const turn = normalizeTurn({
    id: "turn",
    status: "inProgress",
    items: [
      {
        id: "note",
        type: "agentMessage",
        phase: "commentary",
        text: "Checking files",
      },
      {
        id: "cmd",
        type: "commandExecution",
        command: "npm test",
        status: "inProgress",
        aggregatedOutput: "Test output",
      },
      {
        id: "tool",
        type: "mcpToolCall",
        tool: "Read browser",
        status: "inProgress",
      },
      { id: "newest", type: "agentMessage", phase: "commentary", text: "Latest spoken update" },
      { id: "private", type: "reasoning", text: "Private reasoning" },
    ],
  });
  const active = renderToStaticMarkup(
    createElement(Turn, { turn, chatId: "chat" }),
  );
  assert.match(active, /class="turn-work" open=""/);
  assert.ok(active.indexOf("Checking files") < active.indexOf("npm test"));
  assert.ok(active.indexOf("npm test") < active.indexOf("Read browser"));
  assert.ok(active.indexOf("Read browser") < active.indexOf("Latest spoken update"));
  assert.equal((active.match(/Checking files/g) || []).length, 1);
  assert.match(active, /class="tool-activity-group"><summary>/);
  assert.ok(!active.includes("Tools &amp; earlier updates"));
  assert.equal(turn.activity[0].text, "Checking files");
  assert.ok(active.includes("Running"));
  assert.ok(active.includes("Read browser"));
  assert.ok(!active.includes("Private reasoning"));
  const done = renderToStaticMarkup(
    createElement(Turn, {
      turn: { ...turn, status: "completed", durationMs: 5000 },
      chatId: "chat",
    }),
  );
  assert.match(done, /class="turn-work"><summary>/);
  assert.ok(done.includes("Worked for 5s"));
});

test("steering splits bubbles in item order with one timing and token total", () => {
  const turn = normalizeTurn({ id: "steered", status: "completed", durationMs: 5000, items: [
    { id: "u1", type: "userMessage", text: "Start the task" },
    { id: "p1", type: "agentMessage", phase: "commentary", text: "Progress before steering" },
    { id: "u2", type: "userMessage", text: "Change direction" },
    { id: "p2", type: "agentMessage", phase: "commentary", text: "Progress after steering" },
    { id: "u3", type: "userMessage", text: "One more correction" },
    { id: "a", type: "agentMessage", phase: "final_answer", text: "Final corrected result" },
  ] }, { usage: tokens({ total_tokens: 1234 }) });
  for (const html of [
    renderToStaticMarkup(createElement(Turn, { turn, chatId: "chat" })),
    renderToStaticMarkup(createElement(NativeChatTurn, { turn, chatId: "chat", agent: starterTeam.agents[0] })),
  ]) {
    assert.ok(html.indexOf("Progress before steering") < html.indexOf("Change direction"));
    assert.ok(html.indexOf("Change direction") < html.indexOf("Progress after steering"));
    assert.ok(html.indexOf("Progress after steering") < html.indexOf("One more correction"));
    assert.ok(html.indexOf("One more correction") < html.indexOf("Final corrected result"));
    assert.equal((html.match(/Worked for 5s/g) || []).length, 1);
    assert.equal((html.replace(/<[^>]*>/g, "").match(/1,234 turn tokens/g) || []).length, 1);
  }
});

test("chat Markdown renders headings, emphasis, lists, tables and safe links", () => {
  const html = renderToStaticMarkup(
    createElement(Markdown, {
      text: "## Finding\n\n**Important** and `code`\n\n- One\n- Two\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))",
    }),
  );
  assert.match(html, /<h2>Finding<\/h2>/);
  assert.match(html, /<strong>Important<\/strong>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<table>/);
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes('href="javascript:'));
});
test("turn details expose actual timing and file diffs without raw reasoning", () => {
  const turn = normalizeTurn({
    id: "turn",
    status: "completed",
    durationMs: 372000,
    items: [
      { id: "user", type: "userMessage", content: [{ text: "Fix" }] },
      { id: "reasoning", type: "reasoning", content: "private reasoning" },
      {
        id: "update",
        type: "agentMessage",
        phase: "commentary",
        text: "Checking",
      },
      {
        id: "answer",
        type: "agentMessage",
        phase: "final_answer",
        text: "Done",
      },
      {
        id: "files",
        type: "fileChange",
        status: "completed",
        changes: [
          {
            path: "app.ts",
            diff: "--- a/app.ts\n+++ b/app.ts\n-old\n+new\n+extra",
          },
        ],
      },
    ],
  });
  assert.equal(durationLabel(turn.durationMs), "Worked for 6m 12s");
  assert.equal(turn.files[0].added, 2);
  assert.equal(turn.files[0].removed, 1);
  assert.equal(turn.answers[0].text, "Done");
  assert.ok(!JSON.stringify(turn).includes("private reasoning"));
  assert.equal(durationLabel(), "Timing unavailable");
});
test("usage records distinguish inherited fork tokens and ignore repeated snapshots", async () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-usage-")),
    path = join(dir, "record.jsonl");
  const info = (input: number, output: number) => ({
    input_tokens: input,
    cached_input_tokens: 0,
    output_tokens: output,
    reasoning_output_tokens: 0,
    total_tokens: input + output,
  });
  writeFileSync(
    path,
    [
      {
        type: "turn_context",
        payload: { turn_id: "one", model: "gpt-6-luna" },
      },
      {
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: info(110, 10),
            last_token_usage: info(10, 2),
          },
        },
      },
      {
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: info(110, 10),
            last_token_usage: info(10, 2),
          },
        },
      },
      {
        type: "turn_context",
        payload: {
          turn_id: "two",
          model: "gpt-6.1-sol",
          approval_policy: "on-request",
          approvals_reviewer: "auto_review",
          sandbox_policy: { type: "workspace-write" },
        },
      },
      {
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: info(130, 15),
            last_token_usage: info(20, 5),
            model_context_window: 100000,
          },
        },
      },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n"),
  );
  try {
    const usage = await recordedUsage(path, dir);
    assert.equal(usage.get("one")?.usage?.totalTokens, 12);
    assert.equal(usage.get("two")?.usage?.totalTokens, 25);
    assert.equal(usage.get("two")?.model, "gpt-6.1-sol");
    assert.equal(usage.get("two")?.permissions?.mode, "auto");
    assert.equal(usage.get("two")?.permissions?.allowWrite, true);
    assert.deepEqual(usage.get("two")?.context, { used: 25, limit: 100000 });
    assert.equal(usage.get("one")?.context, undefined);
    if (process.platform === "win32")
      assert.equal(
        (await recordedUsage(`\\\\?\\${path}`, dir)).get("two")?.usage
          ?.totalTokens,
        25,
      );
    assert.equal((await recordedUsage(path, join(dir, "unrelated"))).size, 0);
  } finally {
    unlinkSync(path);
    rmdirSync(dir);
  }
  assert.equal(
    usageDelta(
      tokens({ total_tokens: 120 }),
      undefined,
      tokens({ total_tokens: 12 }),
    ).totalTokens,
    12,
  );
});

test("large chat histories retain recent live activity without inventing partial usage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-large-lifecycle-"));
  const path = join(dir, "large.jsonl");
  writeFileSync(path, "");
  truncateSync(path, 101 * 1024 * 1024);
  appendFileSync(path, "\n" + JSON.stringify({ type: "event_msg", timestamp: "2026-10-27T03:34:47Z", payload: { type: "task_started", turn_id: "large-live" } }) + "\n" + JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { total_tokens: 90000 }, last_token_usage: { total_tokens: 100 }, model_context_window: 100000 } } }) + "\n");
  try {
    const records = await recordedUsage(path, dir);
    assert.equal(normalizeTurn({ id: "large-live", status: "interrupted", items: [] }, records.get("large-live")).status, "inProgress");
    assert.equal(records.get("large-live")?.usage, undefined);
    assert.deepEqual(records.get("large-live")?.context, { used: 100, limit: 100000 });
    appendFileSync(path, JSON.stringify({ type: "event_msg", timestamp: "2026-10-27T03:35:47Z", payload: { type: "task_complete", turn_id: "large-live" } }) + "\n");
    assert.equal((await recordedUsage(path, dir)).get("large-live")?.status, "completed");
  } finally { unlinkSync(path); rmdirSync(dir); }
});

test("explicit native lifecycle keeps externally running turns open until completion or interruption", async () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-lifecycle-"));
  const path = join(dir, "lifecycle.jsonl");
  const event = (type: string, turn_id: string, timestamp: string) =>
    JSON.stringify({
      type: "event_msg",
      timestamp,
      payload: { type, turn_id },
    });
  const started = event("task_started", "one", "2026-10-24T04:00:00Z");
  writeFileSync(path, started + "\n");
  try {
    let records = await recordedUsage(path, dir);
    const live = normalizeTurn(
      { id: "one", status: "interrupted", items: [] },
      records.get("one"),
    );
    assert.equal(live.status, "inProgress");
    assert.equal(live.startedAt, Date.parse("2026-10-24T04:00:00Z") / 1000);
    assert.equal(live.completedAt, undefined);
    writeFileSync(
      path,
      started +
        "\n" +
        event("task_complete", "one", "2026-10-24T04:01:00Z") +
        "\n" +
        event("task_started", "two", "2026-10-24T04:02:00Z") +
        "\n" +
        event("turn_aborted", "two", "2026-10-24T04:02:10Z") +
        "\n",
    );
    records = await recordedUsage(path, dir);
    assert.equal(
      normalizeTurn(
        { id: "one", status: "interrupted", items: [] },
        records.get("one"),
      ).durationMs,
      60000,
    );
    assert.equal(records.get("one")?.status, "completed");
    assert.equal(records.get("two")?.status, "interrupted");
  } finally {
    unlinkSync(path);
    rmdirSync(dir);
  }
});

test("Windows Codex image links normalize slash-prefixed drives before registry lookup and rendering", () => {
  const path = "C:/Work/My Project/image (1).png";
  const text = `![Preview](</${path}>)`;
  assert.equal(localImagePath(`/C:/Work/My%20Project/image%20(1).png`), path);
  assert.equal(localImageAttachments(text)[0].path, path);
  const html = renderToStaticMarkup(
    createElement(Markdown, { text, chatId: "image-chat" }),
  );
  assert.ok(html.includes("path=C%3A%2FWork%2FMy%20Project"));
  assert.ok(!html.includes("path=%2FC%3A"));
  assert.match(html, /aria-label="Preview image: Preview"/);
});
