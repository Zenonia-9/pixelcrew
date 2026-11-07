import type { ThreadGoalStatus } from "./types";

export const GOAL_CONTINUATION_INPUT = "<pixelcrew_goal_continuation>\nContinue working toward the existing thread goal using the conversation so far. This is an automatic continuation of the user's goal. Follow its current lifecycle, permissions, objective and budget; do not reset them.\n</pixelcrew_goal_continuation>";

export const threadGoalCanEdit = (status: ThreadGoalStatus) =>
  status !== "complete";

export const threadGoalCanResume = (status: ThreadGoalStatus) =>
  status === "paused" || status === "blocked" || status === "usageLimited";

export const threadGoalStatusAfterEdit = (status: ThreadGoalStatus) =>
  status === "paused" ? "paused" : "active";
