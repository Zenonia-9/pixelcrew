import type { Agent, RuntimeStatus } from "./types";
export function taskComplexity(context: string, references = 0) {
  const demanding =
    /\b(architect\w*|migrat\w*|concurren\w*|security|authentication|race condition|distributed|refactor\w*|production|financial|reconcil\w*)\b/gi;
  const signals = new Set(
    (context.match(demanding) || []).map((s) => s.toLowerCase()),
  ).size;
  const level =
    signals >= 2 || context.length > 24000 || references > 5
      ? "complex"
      : signals || context.length > 6000 || references > 1
        ? "moderate"
        : "simple";
  return {
    level,
    reason: `${level} task · ${context.length.toLocaleString()} context characters · ${references} references · ${signals} complexity signals`,
  } as const;
}
export const preferredModel = (a: Agent) =>
  a.role === "lead" || a.role === "builder" ? "gpt-6.1-sol" : "gpt-6-luna";
export function resolveProfile(
  a: Agent,
  catalog: RuntimeStatus["models"],
  override?: { model: string; reasoning?: string },
  context?: { text: string; references?: number },
): Agent {
  const complexity = context
    ? taskComplexity(context.text, context.references)
    : undefined;
  const preferred = complexity
    ? complexity.level === "complex" ||
      (complexity.level === "moderate" &&
        (a.role === "lead" || a.role === "builder"))
      ? "gpt-6.1-sol"
      : "gpt-6-luna"
    : preferredModel(a);
  const selected = override ? override.model : a.model;
  const model =
    (selected && catalog.some((m) => m.id === selected) ? selected : "") ||
    (catalog.some((m) => m.id === preferred)
      ? preferred
      : catalog.find((m) => m.isDefault)?.id || "");
  const entry = catalog.find((m) => m.id === model);
  const reasoning =
    (override ? override.reasoning : a.reasoning) ||
    (complexity &&
    entry?.efforts?.includes(
      complexity.level === "complex"
        ? "high"
        : complexity.level === "simple"
          ? "low"
          : "medium",
    )
      ? complexity.level === "complex"
        ? "high"
        : complexity.level === "simple"
          ? "low"
          : "medium"
      : entry?.efforts?.includes("medium")
        ? "medium"
        : entry?.defaultEffort);
  if (reasoning && entry?.efforts?.length && !entry.efforts.includes(reasoning))
    throw new Error(
      `Reasoning effort ${reasoning} is unavailable for ${model}.`,
    );
  return { ...a, model, reasoning: reasoning as Agent["reasoning"] };
}
