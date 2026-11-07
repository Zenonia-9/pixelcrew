import { userContent } from "./chat-presentation";
import type { ChatTurn, Run } from "./types";
import type { GroupMessage } from "./group-chat";

export type ConversationItem =
  | { kind: "studio"; message: GroupMessage; at: number }
  | { kind: "native"; turn: ChatTurn; at: number };
export function conversationTimeline(
  messages: GroupMessage[],
  turns: ChatTurn[],
): ConversationItem[] {
  const items: ConversationItem[] = [
    ...messages.map((message) => ({
      kind: "studio" as const,
      message,
      at: Date.parse(message.at),
    })),
    ...turns.map((turn) => ({
      kind: "native" as const,
      turn,
      at: (turn.startedAt ?? turn.completedAt ?? Infinity) * 1000,
    })),
  ];
  return items.sort(
    (a, b) =>
      (Number.isFinite(a.at) ? a.at : Number.MAX_SAFE_INTEGER) -
      (Number.isFinite(b.at) ? b.at : Number.MAX_SAFE_INTEGER),
  );
}

/** Prefer the recorded Normal turn over its app-side progress placeholder. */
export function groupConversationTimeline(messages: GroupMessage[], turns: ChatTurn[], runs: Run[]): ConversationItem[] {
  const turnIds = new Set(turns.map(turn => turn.id));
  const normalOwners = new Map<string, Run>();
  const recordedAssignments = new Set<string>();
  for (const run of runs) if (run.options?.mode === "normal") for (const assignment of run.assignments) {
    if (assignment.turnId && turnIds.has(assignment.turnId)) { normalOwners.set(assignment.turnId, run); recordedAssignments.add(assignment.id); }
  }
  const embeddedSteers = new Set<string>();
  for (const run of runs) for (const assignment of run.assignments) {
    const turn = turns.find(item => item.id === assignment.turnId);
    if (!turn?.sequence) continue;
    for (const user of turn.users) {
      const text = userContent(user.text).text.trim();
      if (run.inbox?.some(message => message.text.trim() === text)) embeddedSteers.add(`${run.id}:${text}`);
    }
  }
  const studio = messages.filter(message =>
    (message.role !== "member" || !recordedAssignments.has(message.assignmentId || "")) &&
    !(message.role === "user" && embeddedSteers.has(`${message.runId}:${message.text.trim()}`)));
  const known = new Set(runs.flatMap(run => run.assignments.map(assignment => assignment.turnId)));
  const native = turns.flatMap(turn => {
    const owner = normalOwners.get(turn.id);
    if (owner) return [{ ...turn, users: turn.users.filter(user => {
      const text = userContent(user.text).text.trim();
      return !studio.some(message => message.role === "user" && message.runId === owner.id && message.text.trim() === text);
    }) }];
    if (known.has(turn.id)) return [];
    if (turn.users.some(user => { try { return typeof JSON.parse(user.text).assignment === "string"; } catch { return runs.some(run => run.task.trim() === user.text.trim()); } })) return [];
    return [turn];
  });
  return conversationTimeline(studio, native);
}
