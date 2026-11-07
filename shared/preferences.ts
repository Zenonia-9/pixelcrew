import { z } from "zod";
import { deviceToolSchema } from "./types";
export const composerPreferencesSchema = z.object({
  mode: z.enum(["team", "plan", "normal", "goal"]),
  permissions: z.enum(["ask", "auto", "custom"]),
  allowWrite: z.boolean(),
  models: z.record(
    z.string(),
    z.object({ model: z.string(), reasoning: z.string().optional() }),
  ),
  deviceTools: z.array(deviceToolSchema).max(3).optional(),
  deviceSessionId: z.string().uuid().optional(),
});
export const preferencesSchema = z.object({
  followupBehavior: z.enum(["queue", "steer"]).default("queue"),
  allowChrome: z.boolean().default(false),
  allowWindowsComputer: z.boolean().default(false),
  pinnedProjects: z.array(z.string()).optional(),
  composers: z.record(z.string(), composerPreferencesSchema).default({}),
});
export type ComposerPreferences = z.infer<typeof composerPreferencesSchema>;
export type Preferences = z.infer<typeof preferencesSchema>;
export const composerKey = (
  chat?: string,
  project?: string,
  team = "default",
) =>
  `${team === "default" ? "" : `team:${team}:`}${chat ? `chat:${chat}` : `project:${project || "local"}`}`;
