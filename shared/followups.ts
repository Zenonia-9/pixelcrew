import type { RunOptions } from "./types";
export interface PendingFollowup {
  id: string; threadId: string; text: string; at: string; teamId: string; accountId: string;
  workspace: string; criteria: string; references: string[]; allowWrite: boolean; options: RunOptions;
  error?: string;
}
export function followupDelivery(preferred: "queue" | "steer", alternate: boolean) { return alternate ? preferred === "queue" ? "steer" : "queue" : preferred; }
