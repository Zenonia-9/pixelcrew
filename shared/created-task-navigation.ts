import type { Run } from "./types";

type CreatedRun = Pick<Run, "demo" | "chatThreadId" | "assignments" | "options">;

export type CreatedTaskDestination =
  | { kind: "run" }
  | { kind: "reuse-current" }
  | { kind: "thread"; threadId: string }
  | { kind: "wait-for-thread" };

/** Choose the chat destination after the first message creates a run. */
export function createdTaskDestination(
  run: CreatedRun,
  currentChatId?: string,
): CreatedTaskDestination {
  if (run.demo) return { kind: "run" };
  if (
    run.options?.sourceThreadId &&
    currentChatId === run.options.sourceThreadId &&
    (run.options.mode === "normal" || run.chatThreadId === currentChatId)
  )
    return { kind: "reuse-current" };
  const threadId = run.chatThreadId || run.assignments.find(item => item.threadId)?.threadId;
  return threadId ? { kind: "thread", threadId } : { kind: "wait-for-thread" };
}
