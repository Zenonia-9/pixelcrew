import { createReadStream, statSync } from "node:fs";
import { GOAL_CONTINUATION_INPUT } from "../shared/thread-goal-controls";
import { createInterface } from "node:readline";
import { resolve, relative, isAbsolute } from "node:path";
import { homedir } from "node:os";
import type { ChatTurn, TokenUsage } from "../shared/types";
import { userContent, type ChatAttachment } from "../shared/chat-presentation";
import {
  recordedPermissions,
  type ChatPermissions,
} from "../shared/chat-permissions";

export const tokens = (u: any): TokenUsage => ({
  inputTokens: u.inputTokens ?? u.input_tokens ?? 0,
  cachedInputTokens: u.cachedInputTokens ?? u.cached_input_tokens ?? 0,
  outputTokens: u.outputTokens ?? u.output_tokens ?? 0,
  reasoningOutputTokens:
    u.reasoningOutputTokens ?? u.reasoning_output_tokens ?? 0,
  totalTokens: u.totalTokens ?? u.total_tokens ?? 0,
});
export function addUsage(a: TokenUsage | undefined, b: TokenUsage): TokenUsage {
  return Object.fromEntries(
    Object.keys(b).map((k) => [
      k,
      (a?.[k as keyof TokenUsage] || 0) + b[k as keyof TokenUsage],
    ]),
  ) as unknown as TokenUsage;
}
export function usageDelta(
  total: TokenUsage,
  previous: TokenUsage | undefined,
  last: TokenUsage,
): TokenUsage {
  if (!previous) return last;
  return Object.fromEntries(
    Object.keys(total).map((k) => [
      k,
      Math.max(
        0,
        total[k as keyof TokenUsage] - previous[k as keyof TokenUsage],
      ),
    ]),
  ) as unknown as TokenUsage;
}
interface RecordedTurn {
  permissions?: ChatPermissions;
  context?: { used: number; limit: number };
  model?: string;
  usage?: TokenUsage;
  status?: string;
  startedAt?: number;
  completedAt?: number;
}
const usageCache = new Map<
  string,
  { stamp: string; data: Map<string, RecordedTurn> }
>();
// App-server exposes live token notifications, but not historical turn usage.
// Read usage and explicit public lifecycle metadata from the server-provided rollout path.
// Never scan arbitrary browser-supplied paths or return raw rollout contents.
export async function recordedUsage(path?: string, rootOverride?: string) {
  const result = new Map<string, RecordedTurn>();
  if (!path) return result;
  const codexRoot = rootOverride
    ? resolve(rootOverride)
    : resolve(process.env.CODEX_HOME || resolve(homedir(), ".codex"));
  const plainPath = path.startsWith("\\\\?\\UNC\\")
    ? `\\\\${path.slice(8)}`
    : path.startsWith("\\\\?\\")
      ? path.slice(4)
      : path;
  const file = resolve(plainPath),
    rel = relative(codexRoot, file);
  if (rel.startsWith("..") || isAbsolute(rel) || !rel.endsWith(".jsonl"))
    return result;
  let stamp: string;
  let tailStart = 0;
  try {
    const s = statSync(file);
    if (!s.isFile()) return result;
    // Large conversations still need live lifecycle state. Bound I/O and leave
    // historical usage unknown when the beginning of a turn is outside the tail.
    if (s.size > 100 * 1024 * 1024) tailStart = s.size - 8 * 1024 * 1024;
    stamp = `${s.mtimeMs}:${s.size}`;
  } catch {
    return result;
  }
  if (usageCache.get(file)?.stamp === stamp) return usageCache.get(file)!.data;
  let turnId: string | undefined, previous: TokenUsage | undefined;
  const lines = createInterface({
    input: createReadStream(file, { start: tailStart }),
    crlfDelay: Infinity,
  });
  try {
    for await (const line of lines) {
      if (
        !line.includes('"turn_context"') &&
        !line.includes('"token_count"') &&
        !line.includes('"task_started"') &&
        !line.includes('"task_complete"') &&
        !line.includes('"turn_aborted"')
      )
        continue;
      let item: any;
      try {
        item = JSON.parse(line);
      } catch {
        continue;
      }
      if (item.type === "turn_context") {
        turnId = item.payload.turn_id;
        if (turnId)
          result.set(turnId, {
            ...result.get(turnId),
            model: item.payload.model,
            permissions: recordedPermissions(item.payload),
          });
      }
      if (item.type === "event_msg" && item.payload.type === "task_started") {
        turnId = item.payload.turn_id || turnId;
        if (turnId)
          result.set(turnId, {
            ...result.get(turnId),
            status: "inProgress",
            startedAt: Date.parse(item.timestamp) / 1000,
            completedAt: undefined,
          });
      }
      if (
        item.type === "event_msg" &&
        ["task_complete", "turn_aborted"].includes(item.payload.type)
      ) {
        const id = item.payload.turn_id || turnId;
        if (id)
          result.set(id, {
            ...result.get(id),
            status:
              item.payload.type === "task_complete"
                ? "completed"
                : "interrupted",
            completedAt: Date.parse(item.timestamp) / 1000,
          });
      }
      if (item.type === "event_msg" && item.payload.type === "token_count") {
        const info = item.payload.info;
        if (turnId && Number(info?.model_context_window) > 0 && info.last_token_usage)
          result.set(turnId, {
            ...result.get(turnId),
            context: {
              used: tokens(info.last_token_usage).totalTokens,
              limit: Number(info.model_context_window),
            },
          });
        // Historical turn totals require the start of the rollout. Context is
        // an event-local measurement and remains reliable in the bounded tail.
        if (tailStart === 0 && info?.total_token_usage) {
          const total = tokens(info.total_token_usage),
            delta = usageDelta(total, previous, tokens(info.last_token_usage || {}));
          if (turnId)
            result.set(turnId, {
              ...result.get(turnId),
              usage: addUsage(result.get(turnId)?.usage, delta),
            });
          previous = total;
        }
      }
    }
    if (usageCache.size > 100)
      usageCache.delete(usageCache.keys().next().value!);
    usageCache.set(file, { stamp, data: result });
  } catch {
    return result;
  } finally {
    lines.close();
  }
  return result;
}
export function normalizeTurn(turn: any, recorded?: RecordedTurn): ChatTurn {
  const items = turn.items || [],
    text = (item: any) =>
      item.text ||
      (item.content || [])
        .map((c: any) => c.text || (c.path ? `[Attachment: ${c.path}]` : ""))
        .join("\n");
  const error = typeof turn.error === "string" ? turn.error : turn.error?.message;
  const status = error && turn.status === "failed" ? "failed" : recorded?.status || turn.status;
  const startedAt = turn.startedAt ?? recorded?.startedAt;
  const completedAt =
    status === "inProgress"
      ? undefined
      : (turn.completedAt ?? recorded?.completedAt);
  return {
    id: turn.id,
    sequence: items.flatMap((item: any) => {
      if (!item.id || item.type === "reasoning") return [];
      if (item.type === "userMessage") return text(item) === GOAL_CONTINUATION_INPUT ? [] : [{ kind: "user" as const, id: item.id }];
      return [{ kind: (item.type === "plan" || item.type === "agentMessage" && item.phase !== "commentary" ? "answer" : "activity") as "answer" | "activity", id: item.id }];
    }),
    status,
    error,
    startedAt,
    completedAt,
    durationMs:
      status === "inProgress"
        ? undefined
        : (turn.durationMs ??
          (startedAt != null && completedAt != null
            ? (completedAt - startedAt) * 1000
            : undefined)),
    model: recorded?.model || turn.model,
    usage: recorded?.usage,
    context: recorded?.context,
    users: items
      .filter((i: any) => i.type === "userMessage" && text(i) !== GOAL_CONTINUATION_INPUT)
      .map((i: any) => ({
        id: i.id,
        ...userContent(
          text(i),
          (i.content || [])
            .filter((c: any) => c.path)
            .map((c: any) => ({
              path: c.path,
              name: c.path.split(/[\\/]/).at(-1),
              kind: /\.(png|jpe?g|gif|webp)$/i.test(c.path) ? "image" : "file",
            })) as ChatAttachment[],
        ),
      }))
      .filter((i: any) => i.text || i.attachments.length),
    answers: items
      .filter(
        (i: any) =>
          (i.type === "agentMessage" && i.phase !== "commentary") ||
          i.type === "plan",
      )
      .map((i: any) => ({ id: i.id, text: text(i) })),
    activity: items
      .filter(
        (i: any) =>
          !["userMessage", "reasoning"].includes(i.type) &&
          !(i.type === "agentMessage" && i.phase !== "commentary") &&
          i.type !== "plan",
      )
      .map((i: any) => ({
        id: i.id,
        type: i.type,
        title:
          i.command ||
          (i.type === "agentMessage"
            ? "Update"
            : i.tool ||
              i.name ||
              (
                {
                  fileChange: "File changes",
                  webSearch: "Web search",
                  mcpToolCall: "Connected tool",
                } as Record<string, string>
              )[i.type] ||
              i.type),
        text:
          text(i) ||
          i.aggregatedOutput ||
          i.query ||
          (i.error ? JSON.stringify(i.error) : ""),
        status: i.status,
        ...(["subAgentActivity", "collabAgentToolCall"].includes(i.type) ? {
          childThreadIds: [...new Set([i.agentThreadId, ...(i.receiverThreadIds || [])].filter((id): id is string => typeof id === "string"))],
          childAgentPath: i.agentPath,
        } : {}),
      })),
    files: items
      .filter((i: any) => i.type === "fileChange")
      .flatMap((i: any) =>
        (i.changes || []).map((c: any) => ({
          path: c.path,
          diff: c.diff || "",
          status: i.status || "unknown",
          added: (c.diff || "")
            .split("\n")
            .filter((l: string) => l.startsWith("+") && !l.startsWith("+++"))
            .length,
          removed: (c.diff || "")
            .split("\n")
            .filter((l: string) => l.startsWith("-") && !l.startsWith("---"))
            .length,
        })),
      ),
  };
}
