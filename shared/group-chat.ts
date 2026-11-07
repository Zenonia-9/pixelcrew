import type { Agent, Run, StudioEvent, ChatTurn } from "./types";
import { normalAgent } from "./normal-agent";
import { conversationBusy } from "./conversation-errors";
import {
  readableResult,
  shortNote,
  userContent,
  type ChatAttachment,
} from "./chat-presentation";
export interface GroupMessage {
  id: string;
  at: string;
  role: "user" | "member";
  text: string;
  note: string;
  agent?: Agent;
  recipient?: string;
  final?: boolean;
  direct?: boolean;
  status?: string;
  assignmentId?: string;
  runId: string;
  attachments?: ChatAttachment[];
  question?: string;
  awaitingReply?: boolean;
}
export function groupMessages(
  runs: Run[],
  events: StudioEvent[],
): GroupMessage[] {
  const messages: GroupMessage[] = [];
  const requests = new Map<string, Run>();
  for (const run of runs) {
    const request = userContent(
      run.task,
      (run.options?.attachments || []).map((a) => ({
        path: a.path,
        name: a.name,
        kind: a.kind === "image" ? "image" : "file",
      })),
    );
    const requestKey = `${run.chatThreadId || run.id}:${request.text}`;
    const previous = requests.get(requestKey);
    if (!previous || !["failed", "interrupted"].includes(previous.status))
      messages.push({
        id: `${run.id}:request`,
        at: run.createdAt,
        role: "user",
        text: request.text,
        note: request.text,
        runId: run.id,
        attachments: request.attachments,
      });
    requests.set(requestKey, run);
    for (const message of (run.inbox || []).filter(message => message.status !== "queued"))
      messages.push({
        id: message.id,
        at: message.at,
        role: "user",
        text: message.text,
        note: message.text,
        runId: run.id,
        status: message.status,
        attachments: message.attachments,
      });
    for (const assignment of run.assignments) {
      if (!assignment.output && conversationBusy(assignment.error)) continue;
      const savedAgent = run.team.agents.find(
        (a) => a.id === assignment.agentId,
      );
      if (!savedAgent) continue;
      const direct = run.options?.mode === "normal";
      const agent = direct
        ? normalAgent(savedAgent, 8, run.team.normalAppearance)
        : savedAgent;
      const handoffs = events.filter(
        (e) =>
          e.runId === run.id && e.handoff?.sourceAssignmentId === assignment.id,
      );
      const lead = run.team.agents.find((a) => a.role === "lead");
      const handoff =
        handoffs.find((e) => e.handoff?.to === lead?.id) || handoffs[0];
      const progress = events
        .filter(
          (e) =>
            e.assignmentId === assignment.id &&
            e.kind === "message" && !!e.text.trim(),
        )
        .at(-1);
      if (
        assignment.goalContinuation &&
        !assignment.output.trim() &&
        !progress?.text.trim() &&
        !assignment.error
      ) continue;
      const working = ["running", "queued", "approval"].includes(
        assignment.status,
      );
      const text = working
        ? assignment.output || progress?.text || assignment.objective
        : readableResult(
            assignment.output || assignment.error || assignment.objective,
          );
      messages.push({
        id: assignment.id,
        at: assignment.finishedAt || assignment.startedAt || run.createdAt,
        role: "member",
        agent,
        question: assignment.question,
        awaitingReply: run.question?.assignmentId === assignment.id,
        text,
        note: shortNote(text, 115),
        recipient: assignment.question
          ? "You"
          : assignment.stage === "final"
            ? undefined
            : run.team.agents.find((a) => a.id === handoff?.handoff?.to)?.name,
        final: direct || assignment.stage === "final",
        direct,
        status: assignment.status,
        assignmentId: assignment.id,
        runId: run.id,
      });
    }
  }
  return messages.sort((a, b) => a.at.localeCompare(b.at));
}
export function visibleGroupMessages(runs: Run[], events: StudioEvent[], native: ChatTurn[]) {
  const known = new Set(runs.flatMap(run => run.assignments.map(assignment => assignment.turnId).filter(Boolean)));
  const pending = new Set(runs.filter(run => run.options?.mode === "normal" && ["queued", "running", "approval"].includes(run.status) &&
    run.assignments.some(assignment => !assignment.turnId) && native.some(turn => !known.has(turn.id) && !turn.users.length && (turn.startedAt || 0) * 1000 >= Date.parse(run.createdAt))
  ).map(run => run.id));
  return groupMessages(runs, events).filter(message => message.role !== "member" || !pending.has(message.runId));
}
export function completedBoardTasks(runs: Run[]): Run[] {
  const seen = new Set<string>();
  return [...runs]
    .filter((run) => !run.demo && run.status === "completed" && run.result)
    .sort((a, b) => {
      const at = (run: Run) =>
        run.assignments.at(-1)?.finishedAt || run.createdAt;
      return at(b).localeCompare(at(a));
    })
    .filter((run) => {
      const key = run.chatThreadId || run.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}
