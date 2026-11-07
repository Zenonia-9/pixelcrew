import { characterLooks } from "./character-assets";
import { z } from "zod";
export const states = [
  "idle",
  "planning",
  "working",
  "waiting",
  "approval",
  "completed",
  "failed",
  "interrupted",
] as const;
export type CharacterState = (typeof states)[number];
export const agentSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(40),
  sprite: z.enum(["atlas", "pip", "bolt", "mira", "nova"]),
  look: z
    .enum(characterLooks.map((look) => look.id) as [string, ...string[]])
    .optional(),
  color: z.string().regex(/^#[\da-fA-F]{6}$/),
  role: z.enum(["lead", "researcher", "builder", "reviewer"]),
  title: z.string().min(1).max(100),
  expertise: z.array(z.string().max(80)).max(20),
  biography: z.string().max(2000),
  personality: z.string().max(1000),
  instructions: z.string().max(12000),
  expectedOutput: z.string().max(3000),
  model: z.string().max(100),
  reasoning: z
    .enum(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"])
    .optional(),
  tools: z.array(z.string().max(120)).max(50),
  skills: z.array(z.string().max(2000)).max(30).optional(),
  specialties: z.array(z.string().max(100)).max(8).optional(),
  access: z.enum(["read-only", "workspace-write"]),
  enabled: z.boolean(),
  workstation: z.number().int().min(0).max(11),
});
export const teamSchema = z
  .object({
    version: z.literal(1),
    name: z.string().trim().min(1).max(60),
    normalAppearance: z
      .object({
        name: agentSchema.shape.name.optional(),
        biography: agentSchema.shape.biography.optional(),
        sprite: agentSchema.shape.sprite,
        look: agentSchema.shape.look,
      })
      .optional(),
    agents: z.array(agentSchema).min(1).max(11),
  })
  .superRefine((t, c) => {
    if (t.agents.some((agent) => agent.id === "codex-normal"))
      c.addIssue({
        code: "custom",
        message:
          "Normal Codex is a required separate character, not a team specialist.",
      });
    if (t.agents.filter((a) => a.role === "lead" && a.enabled).length !== 1)
      c.addIssue({
        code: "custom",
        message: "A team needs exactly one enabled lead.",
      });
    if (new Set(t.agents.map((a) => a.id)).size !== t.agents.length)
      c.addIssue({ code: "custom", message: "Agent IDs must be unique." });
    if (new Set(t.agents.map((a) => a.workstation)).size !== t.agents.length)
      c.addIssue({ code: "custom", message: "Workstations must be unique." });
  });
export type Agent = z.infer<typeof agentSchema>;
export type Team = z.infer<typeof teamSchema>;
export type RunStatus =
  | "queued"
  | "running"
  | "approval"
  | "completed"
  | "failed"
  | "interrupted"
  | "cancelled";
export interface Assignment {
  routingReason?: string;
  goalContinuation?: boolean;
  question?: string;
  id: string;
  agentId: string;
  stage: "plan" | "research" | "build" | "review" | "revise" | "final";
  objective: string;
  status: RunStatus;
  output: string;
  error?: string;
  threadId?: string;
  turnId?: string;
  startedAt?: string;
  finishedAt?: string;
  model?: string;
  reasoning?: string;
  metrics?: TurnMetrics;
}
export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}
export interface TurnMetrics {
  durationMs?: number;
  usage?: TokenUsage;
  diff?: string;
  actualModel?: string;
}
export interface ChatTurn {
  sequence?: { kind: "user" | "activity" | "answer"; id: string }[];
  error?: string;
  context?: { used: number; limit: number };
  id: string;
  status: string;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  model?: string;
  usage?: TokenUsage;
  users: {
    id: string;
    text: string;
    attachments?: import("./chat-presentation").ChatAttachment[];
  }[];
  answers: { id: string; text: string }[];
  activity: {
    id: string;
    type: string;
    title: string;
    text: string;
    status?: string;
    childThreadIds?: string[];
    childAgentPath?: string;
  }[];
  files: {
    path: string;
    diff: string;
    status: string;
    added: number;
    removed: number;
  }[];
}
export interface ChatDetail {
  permissions?: import("./chat-permissions").ChatPermissions;
  id: string;
  name: string;
  projectId?: string;
  cwd: string;
  model?: string;
  active?: boolean;
  nextCursor?: string;
  turns: ChatTurn[];
  messages: { id: string; role: string; text: string }[];
}
export const MAX_GOAL_OBJECTIVE_LENGTH = 4000;
export function isValidGoalTokenBudgetInput(value: string) {
  if (!value.trim()) return true;
  const budget = Number(value);
  return Number.isSafeInteger(budget) && budget > 0;
}
export const threadGoalStatusSchema = z.enum([
  "active",
  "paused",
  "blocked",
  "usageLimited",
  "budgetLimited",
  "complete",
]);
export type ThreadGoalStatus = z.infer<typeof threadGoalStatusSchema>;
export const threadGoalUpdateSchema = z.object({
  objective: z.string().trim().min(1).max(MAX_GOAL_OBJECTIVE_LENGTH).optional(),
  status: threadGoalStatusSchema.optional(),
  tokenBudget: z.number().int().positive().nullable().optional(),
});
export const deviceToolSchema = z.enum(["browser", "chrome", "computer"]);
export type DeviceTool = z.infer<typeof deviceToolSchema>;
export const runOptionsSchema = z.object({
  teamId: z.string().min(1).max(100).optional(),
  projectId: z.string().min(1).max(150).optional(),
  sourceThreadId: z.string().min(1).max(150).optional(),
  mode: z.enum(["team", "plan", "normal"]).default("team"),
  goalObjective: z.string().trim().min(1).max(MAX_GOAL_OBJECTIVE_LENGTH).optional(),
  goalTokenBudget: z.number().int().positive().nullable().optional(),
  permissions: z.enum(["ask", "auto", "custom"]).optional(),
  deviceTools: z.array(deviceToolSchema).max(3).optional(),
  deviceSessionId: z.string().uuid().optional(),
  inheritPermissions: z.boolean().optional(),
  continueSourceThread: z.boolean().optional(),
  delivery: z.enum(["steer", "queue"]).optional(),
  models: z
    .record(
      z.string(),
      z.object({
        model: z.string().max(100),
        reasoning: z.string().max(20).optional(),
      }),
    )
    .default({}),
  attachments: z
    .array(
      z.object({
        name: z.string().max(255),
        path: z.string().max(2000),
        kind: z.enum(["file", "image"]),
      }),
    )
    .max(12)
    .default([]),
  mentions: z
    .array(
      z.object({
        type: z.enum(["mention", "skill"]),
        name: z.string().max(200),
        path: z.string().max(2000),
      }),
    )
    .max(20)
    .default([]),
});
export type RunOptions = z.infer<typeof runOptionsSchema>;
export interface CodexChat {
  id: string;
  name: string;
  projectId?: string;
  cwd: string;
  updatedAt: number;
  status?: string;
  statusFlags?: string[];
  model?: string;
  reasoning?: string;
}
export interface ThreadGoal {
  threadId: string;
  objective: string;
  status: ThreadGoalStatus;
  createdAt: number;
  updatedAt: number;
  timeUsedSeconds: number;
  tokensUsed: number;
  tokenBudget?: number | null;
}
export interface Run {
  accountId?: string;
  external?: boolean;
  teamId?: string;
  nativeTeam?: boolean;
  directPlan?: {
    summary: string;
    research: { agentId: string; objective: string }[];
    build: { agentId: string; objective: string }[];
  };
  routingContext?: string;
  autoProfiles?: Record<string, { model: boolean; reasoning: boolean }>;
  question?: { assignmentId: string; text: string };
  groupChat?: boolean;
  chatThreadId?: string;
  inbox?: {
    id: string;
    text: string;
    at: string;
    status: "queued" | "delivered";
    assignmentId?: string;
    attachments?: RunOptions["attachments"];
    references?: string[];
    permissions?: RunOptions["permissions"];
  }[];
  id: string;
  task: string;
  criteria: string;
  workspace: string;
  references: string[];
  team: Team;
  demo: boolean;
  allowWrite: boolean;
  status: RunStatus;
  createdAt: string;
  assignments: Assignment[];
  result: string;
  error?: string;
  revision: number;
  goalInitialized?: boolean;
  options?: RunOptions;
}
export interface StudioEvent {
  seq: number;
  runId: string;
  agentId?: string;
  assignmentId?: string;
  kind:
    "status" | "message" | "tool" | "approval" | "result" | "error" | "handoff";
  text: string;
  at: string;
  handoff?: {
    from: string;
    to: string;
    sourceAssignmentId: string;
    targetAssignmentId: string;
    stage: Assignment["stage"];
    excerpt: string;
    reason?: string;
    objective?: string;
  };
}
export interface Approval {
  id: string;
  runId: string;
  agentId: string;
  assignmentId: string;
  method: string;
  title: string;
  detail: string;
  questions?: {
    id: string;
    header?: string;
    question: string;
    options?: { label: string; description?: string }[];
  }[];
}
export interface CodexProject {
  id: string;
  name: string;
  roots: string[];
}
export interface RuntimeStatus {
  chatTitleRevision?: number;
  completedChats?: { threadId: string; turnId: string; name: string; cwd: string; result: string; finishedAt: string; startedAt: string }[];
  activeChats?: string[];
  chatProgress?: Record<string, string>;
  usage?: import("./account-usage").UsageBucket[];
  resetCredits?: import("./account-usage").ResetCredits;
  usageUpdatedAt?: string;
  usageError?: string;
  connected: boolean;
  authenticated: boolean;
  account?: string;
  models: {
    id: string;
    label: string;
    efforts?: string[];
    defaultEffort?: string;
    isDefault?: boolean;
  }[];
  error?: string;
  version?: string;
  projects?: CodexProject[];
  projectsError?: string;
}
export interface Snapshot {
  queuedMessages?: import("./followups").PendingFollowup[];
  accounts?: { profiles: { id: string; label: string; desktop?: boolean; authType?: "desktop" | "codex" | "pixelcrew" | "pending" }[]; selected: string; disconnected: boolean };
  activeTeamId?: string;
  teams?: { id: string; name: string; members: number }[];
  catalog?: typeof import("../server/builtin-catalog").builtinCatalog;
  layoutPreset?: string;
  layoutBasePreset?: string;
  officeDesign?: string;
  preferences?: import("./preferences").Preferences;
  deviceToolStatus?: Record<string, { available: boolean; reason?: string }>;
  layout?: import("./room-layout").RoomLayout;
  team: Team;
  runs: Run[];
  events: StudioEvent[];
  approvals: Approval[];
  runtime: RuntimeStatus;
}
