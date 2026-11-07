import type { TokenUsage } from "./types";
export interface UsageRecord { id: string; at: number; usage: TokenUsage }
export interface UsageHistory { from: number; to: number; buckets: { at: number; input: number; output: number; total: number }[]; totals: { input: number; output: number; cached: number; total: number }; turns: number; }
export function aggregateUsage(records: UsageRecord[], from: number, to: number, count = 24): UsageHistory {
  const buckets = Array.from({ length: count }, (_, i) => ({ at: from + (to - from) * i / count, input: 0, output: 0, total: 0 }));
  const unique = new Map<string, UsageRecord>();
  for (const record of records) if (record.at >= from && record.at <= to && (!unique.has(record.id) || unique.get(record.id)!.usage.totalTokens < record.usage.totalTokens)) unique.set(record.id, record);
  const totals = { input: 0, output: 0, cached: 0, total: 0 };
  for (const { at, usage } of unique.values()) {
    const bucket = buckets[Math.min(count - 1, Math.floor((at - from) / (to - from) * count))];
    bucket.input += usage.inputTokens; bucket.output += usage.outputTokens; bucket.total += usage.totalTokens;
    totals.input += usage.inputTokens; totals.output += usage.outputTokens; totals.cached += usage.cachedInputTokens; totals.total += usage.totalTokens;
  }
  return { from, to, buckets, totals, turns: unique.size };
}
