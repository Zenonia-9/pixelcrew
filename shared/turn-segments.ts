import type { ChatTurn } from "./types";

/** Steering adds user items inside a turn; retain those boundaries in the UI. */
export function turnSegments(turn: ChatTurn): { turn: ChatTurn; last: boolean }[] {
  if (!turn.sequence) return [{ turn, last: true }];
  const users = new Map(turn.users.map(item => [item.id, item]));
  const activity = new Map(turn.activity.map(item => [item.id, item]));
  const answers = new Map(turn.answers.map(item => [item.id, item]));
  const parts: { users: ChatTurn["users"]; activity: ChatTurn["activity"]; answers: ChatTurn["answers"] }[] = [
    { users: [], activity: [], answers: [] },
  ];
  for (const item of turn.sequence) {
    let part = parts.at(-1)!;
    if (item.kind === "user") {
      const user = users.get(item.id);
      if (!user) continue;
      if (part.activity.length || part.answers.length) {
        part = { users: [], activity: [], answers: [] };
        parts.push(part);
      }
      part.users.push(user);
    } else if (item.kind === "activity") {
      const entry = activity.get(item.id);
      if (entry) part.activity.push(entry);
    } else {
      const answer = answers.get(item.id);
      if (answer) part.answers.push(answer);
    }
  }
  if (parts.length === 1) return [{ turn, last: true }];
  return parts.map((part, index) => {
    const last = index === parts.length - 1;
    return {
      last,
      turn: { ...turn, ...part, id: `${turn.id}:part:${index}`, sequence: undefined,
        files: last ? turn.files : [], usage: last ? turn.usage : undefined,
        error: last ? turn.error : undefined },
    };
  });
}
