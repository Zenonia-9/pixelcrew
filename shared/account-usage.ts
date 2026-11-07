export interface UsageWindow {
  remainingPercent: number;
  windowDurationMins?: number;
  resetsAt?: number;
}
export interface UsageBucket {
  id: string;
  label: string;
  windows: UsageWindow[];
}
export function normalizeAccountUsage(input: any): UsageBucket[] {
  const buckets = input?.rateLimitsByLimitId;
  const entries =
    buckets && Object.keys(buckets).length
      ? Object.entries(buckets)
      : input?.rateLimits
        ? [[input.rateLimits.limitId || "codex", input.rateLimits]]
        : [];
  return entries.map(([id, value]: any) => ({
    id,
    label: value.limitName || (id === "codex" ? "Codex" : id),
    windows: [value.primary, value.secondary]
      .filter(
        (w) =>
          w &&
          typeof w.usedPercent === "number" &&
          Number.isFinite(w.usedPercent),
      )
      .map((w) => ({
        remainingPercent: Math.max(0, Math.min(100, 100 - w.usedPercent)),
        windowDurationMins:
          typeof w.windowDurationMins === "number"
            ? w.windowDurationMins
            : undefined,
        resetsAt: typeof w.resetsAt === "number" ? w.resetsAt : undefined,
      })),
  }));
}
export function usageWindowLabel(minutes?: number): string {
  if (!minutes) return "Limit";
  if (minutes === 10080) return "Weekly";
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

export interface ResetCredits { availableCount: number; credits: { id: string; title: string; expiresAt?: number }[] | null }
export function normalizeResetCredits(input: any): ResetCredits | undefined {
  const summary = input?.rateLimitResetCredits;
  if (!summary || !Number.isSafeInteger(summary.availableCount) || summary.availableCount < 0) return undefined;
  return { availableCount: summary.availableCount, credits: Array.isArray(summary.credits) ? summary.credits.filter((credit: any) => credit.status === "available" && typeof credit.id === "string").map((credit: any) => ({ id: credit.id, title: credit.title || credit.description || (credit.resetType === "codexRateLimits" ? "Full reset (weekly + 5 hr)" : "Usage reset"), expiresAt: typeof credit.expiresAt === "number" ? credit.expiresAt : undefined })) : null };
}
