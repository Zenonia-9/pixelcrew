import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { z } from "zod";
import {
  runOptionsSchema,
  type Agent,
  type Approval,
  type Assignment,
  type Run,
  type StudioEvent,
  type RunOptions,
} from "../shared/types";
import { resolveProfile, taskComplexity } from "../shared/models";
import { planResult, reviewResult } from "../shared/agent-results";
import { clarificationQuestion } from "../shared/chat-presentation";
import { Store } from "./store";
import { WorkspaceScheduler } from "./workspace-scheduler";
import { normalAgent } from "../shared/normal-agent";
import { chatTitle } from "../shared/chat-title";
import {
  conversationBusy,
  conversationBusyMessage,
} from "../shared/conversation-errors";
import type { Runtime } from "./runtime";
const planSchema = z.object({
  summary: z.string(),
  research: z
    .array(z.object({ agentId: z.string(), objective: z.string() }))
    .max(10),
  build: z
    .array(z.object({ agentId: z.string(), objective: z.string() }))
    .max(10),
});
const reviewSchema = z.object({ passed: z.boolean(), findings: z.string() });
const jsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    research: {
      type: "array",
      items: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          objective: { type: "string" },
        },
        required: ["agentId", "objective"],
        additionalProperties: false,
      },
    },
    build: {
      type: "array",
      items: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          objective: { type: "string" },
        },
        required: ["agentId", "objective"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "research", "build"],
  additionalProperties: false,
};
const reviewOutput = {
  type: "object",
  properties: { passed: { type: "boolean" }, findings: { type: "string" } },
  required: ["passed", "findings"],
  additionalProperties: false,
};
export class Engine extends EventEmitter {
  runs: Run[];
  approvals: Approval[] = [];
  busy = new Set<string>();
  scheduler = new WorkspaceScheduler();
  stopping = new Set<string>();
  demoTimers = new Map<string, NodeJS.Timeout>();
  constructor(
    public store: Store,
    public runtime: Runtime,
  ) {
    super();
    this.runs = store.runs();
    for (const run of this.runs) {
      const continued =
        !!run.chatThreadId &&
        this.runs.some(
          (other) =>
            other.id !== run.id &&
            other.createdAt > run.createdAt &&
            other.options?.sourceThreadId === run.chatThreadId,
        );
      if (run.question && continued) {
        run.question = undefined;
        run.status = "interrupted";
        run.error = "Continued in a later message in this chat.";
        store.saveRun(run);
      }
      const last = run.assignments.at(-1);
      const question =
        run.status === "failed" &&
        run.error?.includes("requested plan format") &&
        last?.status === "completed"
          ? clarificationQuestion(last.output)
          : undefined;
      if (question && last) {
        last.question = question;
        run.question = continued
          ? undefined
          : { assignmentId: last.id, text: question };
        run.status = continued ? "interrupted" : "approval";
        run.error = continued
          ? "Continued in a later message in this chat."
          : undefined;
        store.saveRun(run);
      }
      if (run.question && run.status === "approval") continue;
      if (["running", "approval", "queued"].includes(run.status)) {
        run.status = "interrupted";
        run.error = "Service restarted. Reconcile this run before resuming.";
        for (const a of run.assignments)
          if (["running", "approval"].includes(a.status))
            a.status = "interrupted";
        store.saveRun(run);
      }
    }
  }
  save(run: Run) {
    this.store.saveRun(run);
    this.emit("change");
  }
  event(
    run: Run,
    kind: StudioEvent["kind"],
    text: string,
    a?: Assignment,
    handoff?: StudioEvent["handoff"],
  ) {
    const e = this.store.event({
      runId: run.id,
      kind,
      text,
      at: new Date().toISOString(),
      agentId: a?.agentId,
      assignmentId: a?.id,
      handoff,
    });
    this.emit("event", e);
    this.emit("change");
  }
  create(
    task: string,
    workspace: string,
    criteria = "",
    references: string[] = [],
    demo = false,
    allowWrite = false,
    options?: RunOptions,
    routingContext = "",
    accountId = "desktop",
  ) {
    const requestedDeviceTools = options?.deviceTools || [];
    const deviceSettings = this.store.preferences();
    if (options?.mode === "plan" && requestedDeviceTools.some(tool => tool !== "browser"))
      throw new Error("Plan mode allows isolated Browser use only.");
    if (requestedDeviceTools.includes("chrome") && !deviceSettings.allowChrome)
      throw new Error("Chrome access is disabled in Settings → General.");
    if (requestedDeviceTools.includes("computer") && !deviceSettings.allowWindowsComputer)
      throw new Error("Windows Computer access is disabled in Settings → General.");
    if (requestedDeviceTools.length && !options?.deviceSessionId) {
      const previousSession = options?.sourceThreadId && this.runs.find(candidate =>
        candidate.chatThreadId === options?.sourceThreadId && candidate.options?.deviceSessionId,
      )?.options?.deviceSessionId;
      options = { ...runOptionsSchema.parse(options || {}), deviceSessionId: previousSession || randomUUID() };
    }
    if (
      this.runs.some(
        (r) =>
          ["running", "approval", "queued"].includes(r.status) &&
          !!options?.sourceThreadId &&
          (r.chatThreadId === options.sourceThreadId ||
            r.options?.sourceThreadId === options.sourceThreadId),
      )
    )
      throw new Error(
        "This chat already has an active task. Queue or steer a message in that chat.",
      );
    const run: Run = {
      accountId,
      teamId: this.store.activeTeamId(),
      nativeTeam:
        !demo && !!this.runtime.nativeTeams && options?.mode === "team",
      groupChat: !demo && options?.mode !== "normal",
      chatThreadId:
        options?.mode === "team" ? options?.sourceThreadId : undefined,
      inbox: [],
      routingContext,
      autoProfiles: Object.fromEntries(
        this.store.team().agents.map((a) => [
          a.id,
          {
            model: !(options?.models[a.id]
              ? options.models[a.id].model
              : a.model),
            reasoning: !(options?.models[a.id]
              ? options.models[a.id].reasoning
              : a.reasoning),
          },
        ]),
      ),
      id: randomUUID(),
      task,
      criteria,
      workspace,
      references,
      team: {
        ...structuredClone(this.store.team()),
        agents: this.store.team().agents.map((a) =>
          resolveProfile(a, this.runtime.status.models, options?.models[a.id], {
            text: `${routingContext}\n${task}\n${criteria}`,
            references: references.length + (options?.attachments.length || 0),
          }),
        ),
      },
      demo,
      allowWrite,
      status: "queued",
      createdAt: new Date().toISOString(),
      assignments: [],
      result: "",
      revision: 0,
      options,
    };
    if (options?.mode === "normal" || options?.mode === "plan") {
      const lead = run.team.agents.find((a) => a.role === "lead" && a.enabled)!;
      run.team.agents = [normalAgent(lead, 8, run.team.normalAppearance)];
      run.autoProfiles = { "codex-normal": run.autoProfiles![lead.id] };
    }
    this.runs.unshift(run);
    this.save(run);
    this.event(
      run,
      "status",
      demo ? "Office tour started · simulated activity" : "Task queued",
    );
    if (demo) this.demo(run);
    else void this.drive(run);
    return run;
  }
  private agent(run: Run, id: string) {
    const a = run.team.agents.find((a) => a.id === id && a.enabled);
    if (!a) throw new Error(`Unknown or disabled agent: ${id}`);
    return a;
  }
  async queueMessage(
    run: Run,
    text: string,
    attachments: RunOptions["attachments"] = [],
    references: string[] = [],
    delivery: "queue" | "steer" = "queue",
    permissions?: RunOptions["permissions"],
  ) {
    if (!["queued", "running", "approval"].includes(run.status))
      throw Error("The team is not running in this chat.");
    const message: NonNullable<Run["inbox"]>[number] = {
      id: randomUUID(),
      text,
      at: new Date().toISOString(),
      status: "queued" as const,
      attachments,
      references,
      permissions,
    };
    (run.inbox ||= []).push(message);
    if (delivery === "steer" && !run.question) {
      const active = run.assignments.find((a) => a.status === "running");
      if (active && this.runtime.steer) try {
        await this.runtime.steer(
          active,
          `${text}${references.length ? `\nReference paths:\n${references.join("\n")}` : ""}${
            attachments.some((a) => a.kind === "file")
              ? `\nAttached files:\n${attachments
                  .filter((a) => a.kind === "file")
                  .map((a) => a.path)
                  .join("\n")}`
              : ""
          }`,
          attachments,
          message.id,
        );
        message.status = "delivered";
        Object.assign(message, { assignmentId: active.id });
      } catch (error) {
        if (!/turn.*finished|no active turn/i.test(String(error))) {
          run.inbox = run.inbox.filter((m) => m.id !== message.id);
          throw error;
        }
      }
    }
    this.event(run, "message", `You: ${text}`);
    this.save(run);
    if (run.question) {
      run.question = undefined;
      run.error = undefined;
      void this.drive(run);
    }
    return run;
  }
  private async execute(
    run: Run,
    agent: Agent,
    stage: Assignment["stage"],
    objective: string,
    schema?: unknown,
    goalContinuation = false,
  ) {
    if (this.stopping.has(run.id)) throw new Error("Run stopped.");
    let a = run.assignments.find(
      (a) =>
        a.agentId === agent.id &&
        a.stage === stage &&
        a.objective === objective &&
        a.status !== "completed",
    );
    if (!a) {
      a = {
        id: randomUUID(),
        agentId: agent.id,
        stage,
        objective,
        status: "queued",
        output: "",
      };
      run.assignments.push(a);
      if (run.chatThreadId) a.threadId = run.chatThreadId;
    }
    if (a.threadId && a.status === "interrupted") {
      const prior = await this.runtime.reconcile(a);
      if (prior.finished) {
        a.status = "completed";
        a.output = prior.output;
        this.save(run);
        return a.output;
      }
      if (prior.status === "inProgress")
        throw new Error(
          "An earlier turn is still running. Interrupt it before resuming.",
        );
    }
    const auto = run.autoProfiles?.[agent.id];
    if (auto?.model || auto?.reasoning) {
      const text = [
        run.routingContext || "",
        run.task,
        run.criteria,
        objective,
        ...(run.inbox || []).map((m) => m.text),
      ].join("\n");
      const references =
        run.references.length + (run.options?.attachments.length || 0);
      agent = resolveProfile(
        agent,
        this.runtime.status.models,
        {
          model: auto.model ? "" : agent.model,
          reasoning: auto.reasoning ? undefined : agent.reasoning,
        },
        { text, references },
      );
      a.routingReason = `Auto ${auto.model && auto.reasoning ? "model and effort" : auto.model ? "model" : "effort"}: ${taskComplexity(text, references).reason}`;
    }
    const userMessages = (run.inbox || []).filter(
      (message) => message.status === "queued",
    );
    const queuedPermissions = userMessages
      .map((message) => message.permissions)
      .filter((permission): permission is NonNullable<typeof permission> => permission !== undefined)
      .at(-1);
    if (
      queuedPermissions &&
      (run.options?.permissions !== queuedPermissions ||
        run.options.inheritPermissions)
    ) {
      run.options = {
        ...(run.options || runOptionsSchema.parse({})),
        permissions: queuedPermissions,
        inheritPermissions: false,
      };
      this.save(run);
    }
    a.status = "queued";
    a.goalContinuation = goalContinuation || undefined;
    this.save(run);
    const release = await this.scheduler.acquire(
      run.workspace,
      run.allowWrite &&
        (run.nativeTeam ||
          agent.role === "builder" ||
          run.options?.mode === "normal"),
      () => this.stopping.has(run.id),
    );
    a.status = "running";
    a.model = agent.model;
    a.reasoning = agent.reasoning;
    a.startedAt = new Date().toISOString();
    a.error = undefined;
    this.save(run);
    this.event(run, "status", `${agent.name}: ${stage}`, a);
    const assignment = a;
    try {
      const previous = run.assignments
        .filter((x) => x.status === "completed")
        .map((x) => ({
          agent: this.agent(run, x.agentId).name,
          stage: x.stage,
          result: x.output,
        }));
      const shared = new Map<string, Assignment>();
      for (const source of run.assignments.filter(
        (x) => x.status === "completed" && x.agentId !== agent.id,
      ))
        shared.set(source.agentId, source);
      let sharedPublished = false;
      const prompt = JSON.stringify(
        {
          task: run.task,
          acceptanceCriteria: run.criteria,
          referencePaths: run.references,
          assignment: objective,
          speaker: agent.name,
          userMessages: userMessages.map((message) => ({
            text: message.text,
            referencePaths: message.references,
          })),
          team: run.team.agents
            .filter((a) => a.enabled)
            .map((a) => ({
              id: a.id,
              role: a.role,
              expertise: a.expertise,
              access: a.access,
            })),
          previousResults: previous,
          attachments: run.options?.attachments || [],
          requestedTools: run.options?.mentions.map((m) => `$${m.name}`) || [],
        },
        null,
        2,
      );
      const effectiveAgent = {
        ...agent,
        access:
          run.allowWrite &&
          (run.nativeTeam ||
            agent.role === "builder" ||
            run.options?.mode === "normal")
            ? run.options?.mode === "normal" || run.nativeTeam
              ? ("workspace-write" as const)
              : agent.access
            : ("read-only" as const),
      };
      const nativeProgress = new Map<string, string>();
      const output = await this.runtime.execute({
        accountId: run.accountId,
        goalContinuation,
        nativeTeam: run.nativeTeam ? run.team.agents : undefined,
        onSubagent: run.nativeTeam
          ? (event) => {
              const member = run.team.agents.find(
                (candidate) =>
                  candidate.id === event.agentId && candidate.role !== "lead",
              );
              if (!member) return;
              let child = run.assignments.find(
                (candidate) => candidate.threadId === event.threadId,
              );
              if (!child) {
                child = {
                  id: randomUUID(),
                  agentId: member.id,
                  threadId: event.threadId,
                  stage:
                    member.role === "reviewer"
                      ? "review"
                      : member.role === "builder"
                        ? "build"
                        : "research",
                  objective:
                    event.objective || `Native ${member.title} assignment`,
                  status: "running",
                  output: "",
                  startedAt: new Date().toISOString(),
                  model: event.model || member.model,
                  reasoning: event.reasoning || member.reasoning,
                };
                run.assignments.push(child);
                this.event(
                  run,
                  "handoff",
                  `${agent.name} → ${member.name}: ${child.objective}`,
                  child,
                  {
                    from: agent.id,
                    to: member.id,
                    sourceAssignmentId: assignment.id,
                    targetAssignmentId: child.id,
                    stage: child.stage,
                    excerpt: child.objective,
                    reason: "Native specialist assignment",
                    objective: child.objective,
                  },
                );
              }
              const newlyCompleted =
                child.status !== "completed" && event.status === "completed";
              child.status =
                event.status === "running" &&
                this.approvals.some(
                  (approval) => approval.assignmentId === child.id,
                )
                  ? "approval"
                  : event.status;
              if (event.turnId) child.turnId = event.turnId;
              if (event.output !== undefined) child.output = event.output;
              if (["completed", "failed", "interrupted"].includes(event.status))
                child.finishedAt = new Date().toISOString();
              if (event.progress)
                if (nativeProgress.get(child.id) !== event.progress) {
                  nativeProgress.set(child.id, event.progress);
                  this.event(run, "message", event.progress, child);
                }
              if (newlyCompleted)
                this.event(
                  run,
                  "handoff",
                  `${member.name} → ${agent.name}: specialist result`,
                  child,
                  {
                    from: member.id,
                    to: agent.id,
                    sourceAssignmentId: child.id,
                    targetAssignmentId: assignment.id,
                    stage: child.stage,
                    excerpt: child.output.slice(0, 300),
                    reason: "Native specialist result",
                    objective: child.objective,
                  },
                );
              this.save(run);
            }
          : undefined,
        agent: effectiveAgent,
        assignment,
        workspace: run.workspace,
        prompt:
          run.options?.mode === "normal" && userMessages.length
            ? userMessages
                .map(
                  (message) =>
                    `${message.text}${message.references?.length ? `\nReference paths:\n${message.references.join("\n")}` : ""}${
                      message.attachments?.some((a) => a.kind === "file")
                        ? `\nAttached files:\n${message.attachments
                            .filter((a) => a.kind === "file")
                            .map((a) => a.path)
                            .join("\n")}`
                        : ""
                    }`,
                )
                .join("\n\n")
            : run.options?.mode === "normal" && !userMessages.length
              ? `${run.task}${run.references.length ? `\n\nReference files and folders:\n${run.references.join("\n")}` : ""}${
                  run.options.attachments.filter((a) => a.kind === "file")
                    .length
                    ? `\n\nAttached files:\n${run.options.attachments
                        .filter((a) => a.kind === "file")
                        .map((a) => a.path)
                        .join("\n")}`
                    : ""
                }${run.options.mentions.length ? `\n\nRequested tools: ${run.options.mentions.map((m) => `$${m.name}`).join(", ")}` : ""}`
              : run.groupChat
                ? userMessages.length
                  ? userMessages.map((message) => message.text).join("\n\n")
                  : run.assignments.length === 1
                    ? run.task
                    : `${agent.name}: ${objective}`
                : prompt,
        context: run.groupChat ? prompt : undefined,
        responseInstructions: run.groupChat
          ? stage === "plan"
            ? `You are the team coordinator. Your job is to turn the user's request into focused specialist assignments, not to implement yourself. Workspace edits are ${run.allowWrite ? "authorized for enabled builders in the Build stage; delegate implementation to them, even if earlier conversation turns were read-only" : "not authorized for this run"}. Your own planning tools are read-only; this does not prevent you from assigning authorized work to Bolt. Never stop at 'this stage is read-only' when a builder can do the work. Read the existing conversation to resolve short follow-ups and folder corrections. If the user says 'as you like', 'you choose', or otherwise delegates a decision, choose a sensible small solution and proceed without asking the same question again. Ask only if an essential decision genuinely blocks progress. Use request_user_input when available, otherwise begin "Question for you:" and offer two or three concrete choices as "- Label — Description", then WAIT. Do not produce a plan with an unresolved question. Otherwise return a short summary, then headings Research and Build using "- agentId: objective" or "None". For example, a user who allows any Python exercise needs a Build assignment for bolt to inspect the requested folder's naming convention and implement one appropriate exercise. Delegate only useful work, preserve user constraints, and keep replies concise. Do not output JSON.`
            : stage === "review"
              ? "Return a readable review beginning with PASS or CHANGES REQUESTED, followed by findings. Do not output JSON."
              : "Reply in readable Markdown. Do not repeat the original user request."
          : undefined,
        schema: run.groupChat ? undefined : schema,
        options: run.options
          ? {
              ...run.options,
              goalObjective: run.goalInitialized ? undefined : run.options.goalObjective,
              goalTokenBudget: run.goalInitialized ? undefined : run.options.goalTokenBudget,
              attachments: [
                ...(run.groupChat && run.assignments.length > 1
                  ? []
                  : run.options.attachments),
                ...userMessages.flatMap((message) => message.attachments || []),
              ],
            }
          : undefined,
        sourceThreadId:
          !assignment.threadId &&
          (run.options?.mode === "normal" || run.options?.mode === "plan")
            ? run.options?.sourceThreadId
            : undefined,
        title: "New chat",
        onThread: (id) => {
          if (run.groupChat || run.options?.mode === "normal") {
            if (run.chatThreadId && run.chatThreadId !== id)
              throw Error("The runtime changed the shared conversation.");
            run.chatThreadId = id;
          }
          assignment.threadId = id;
          this.save(run);
        },
        onGoalInitialized: () => {
          run.goalInitialized = true;
          this.save(run);
        },
        onTurn: (id) => {
          for (const message of userMessages) {
            message.status = "delivered";
            message.assignmentId = assignment.id;
          }
          assignment.turnId = id;
          if (!sharedPublished) {
            sharedPublished = true;
            for (const source of shared.values())
              this.event(
                run,
                "handoff",
                `${this.agent(run, source.agentId).name} → ${agent.name}: ${source.stage} result shared`,
                assignment,
                {
                  from: source.agentId,
                  to: agent.id,
                  sourceAssignmentId: source.id,
                  targetAssignmentId: assignment.id,
                  stage: source.stage,
                  excerpt: source.output.slice(0, 500),
                  reason: `${{ plan: "Plan", research: "Research findings", build: "Implementation changes", review: "Review findings", revise: "Revised changes", final: "Final summary" }[source.stage]} for ${{ plan: "planning", research: "investigation", build: "implementation", review: "review", revise: "revision", final: "final synthesis" }[stage]}`,
                  objective,
                },
              );
          }
          this.save(run);
        },
        onDelta: (text) => {
          assignment.output = text;
          this.save(run);
        },
        onMetrics: (metrics) => {
          assignment.metrics = { ...assignment.metrics, ...metrics };
          this.save(run);
        },
        onEvent: (kind, text) => this.event(run, kind, text, assignment),
        onApproval: (id, method, p, owner) => {
          const requesting = owner
            ? run.assignments.find(
                (candidate) => candidate.threadId === owner.threadId,
              ) || assignment
            : assignment;
          this.approvals.push({
            id,
            runId: run.id,
            agentId: requesting.agentId,
            assignmentId: requesting.id,
            method,
            title:
              p.command ||
              p.reason ||
              (method === "mcpServer/elicitation/request" ? p.message : undefined) ||
              (p.questions
                ? "Your teammate has a question"
                : method === "item/permissions/requestApproval"
                  ? "Additional permissions requested"
                  : "File changes need approval"),
            detail: JSON.stringify(p, null, 2),
            questions: p.questions,
          });
          requesting.status = "approval";
          run.status = "approval";
          this.event(run, "approval", "Waiting for your approval", requesting);
          this.save(run);
        },
      });
      if (this.stopping.has(run.id)) throw new Error("Run stopped.");
      assignment.output = output;
      assignment.status = "completed";
      assignment.finishedAt = new Date().toISOString();
      this.save(run);
      if (clarificationQuestion(output))
        throw new Error("Waiting for your answer.");
      return output;
    } catch (e) {
      // Preserve the completed question turn; it is not a failed execution.
      if (
        assignment.status === "completed" &&
        clarificationQuestion(assignment.output)
      )
        throw e;
      this.approvals = this.approvals.filter((a) =>
        run.nativeTeam ? a.runId !== run.id : a.assignmentId !== assignment.id,
      );
      if (run.nativeTeam)
        for (const child of run.assignments)
          if (
            child.id !== assignment.id &&
            ["running", "queued", "approval"].includes(child.status)
          )
            child.status = "interrupted";
      assignment.error = conversationBusy(e)
        ? conversationBusyMessage
        : String(e);
      assignment.status =
        this.stopping.has(run.id) || conversationBusy(e)
          ? "interrupted"
          : "failed";
      this.save(run);
      throw e;
    } finally {
      release();
    }
  }
  private completed(
    run: Run,
    agent: Agent,
    stage: Assignment["stage"],
    objective: string,
  ) {
    return run.assignments.find(
      (a) =>
        a.agentId === agent.id &&
        a.stage === stage &&
        a.objective === objective &&
        a.status === "completed" &&
        !a.question,
    );
  }
  private async step(
    run: Run,
    agent: Agent,
    stage: Assignment["stage"],
    objective: string,
    schema?: unknown,
  ) {
    return (
      this.completed(run, agent, stage, objective)?.output ??
      this.execute(run, agent, stage, objective, schema)
    );
  }
  async drive(run: Run) {
    if (this.busy.has(run.id)) return;
    this.busy.add(run.id);
    this.stopping.delete(run.id);
    run.status = "running";
    run.error = undefined;
    this.save(run);
    try {
      const lead = run.team.agents.find((a) => a.role === "lead" && a.enabled)!;
      if (run.nativeTeam) {
        run.result = await this.step(
          run,
          lead,
          "final",
          "Coordinate this task with the configured native specialists and return the final result.",
        );
        while (run.inbox?.some((message) => message.status === "queued")) {
          const pending = run.inbox.find(
            (message) => message.status === "queued",
          )!;
          run.result = await this.execute(
            run,
            lead,
            "final",
            `Handle the queued user request (${pending.id}), using native specialists only where useful.`,
          );
        }
        const unfinished = run.assignments.some(
          (candidate) =>
            candidate.id !==
              run.assignments.find((a) => a.agentId === lead.id)?.id &&
            ["running", "queued", "approval"].includes(candidate.status),
        );
        if (unfinished)
          throw Error(
            "The coordinator finished before its native specialists. Reconcile this task before continuing.",
          );
        run.status = "completed";
        this.event(run, "result", run.result);
        this.save(run);
        return;
      }
      if (run.options?.mode === "normal") {
        const direct = {
          ...lead,
          name: lead.name,
          title: "Coding assistant",
          instructions:
            "Work directly on the user's request. Follow applicable project instructions. Do not follow the Studio team planning/delegation workflow.",
          personality: "Clear and concise",
          expectedOutput: "A direct answer with relevant evidence and changes.",
          access: run.allowWrite
            ? ("workspace-write" as const)
            : ("read-only" as const),
        };
        run.result = await this.step(
          run,
          direct,
          "build",
          "Respond directly to the user.",
        );
        let goalStopped = false;
        while (!this.stopping.has(run.id)) {
          const pending = run.inbox?.find((m) => m.status === "queued");
          if (pending) {
            run.result = await this.execute(run, direct, "build", `Respond to the queued user message (${pending.id}).`);
            continue;
          }
          if (!run.goalInitialized || !run.chatThreadId || !this.runtime.getThreadGoal) break;
          const goal = await this.runtime.getThreadGoal(run.chatThreadId);
          if (!goal || goal.status === "complete") break;
          if (goal.status !== "active") {
            goalStopped = true;
            break;
          }
          const result = await this.execute(run, direct, "build", `Continue the thread goal (${run.assignments.length + 1}).`, undefined, true);
          if (result) run.result = result;
        }
        if (this.stopping.has(run.id)) return;
        run.status = goalStopped ? "interrupted" : "completed";
        this.event(run, "result", run.result);
        this.save(run);
        return;
      }
      if (run.options?.mode === "plan") {
        run.result = await this.step(
          run,
          lead,
          "plan",
          "Develop a clear implementation plan with acceptance criteria and risks. Investigate only as needed. Do not implement or change workspace files.",
        );
        if (clarificationQuestion(run.result))
          throw Error("Waiting for your answer.");
        run.status = "completed";
        this.event(run, "result", run.result);
        this.save(run);
        return;
      }
      const builder = run.team.agents.find(
        (a) =>
          a.enabled && a.role === "builder" && a.access === "workspace-write",
      );
      const clarification = (run.inbox || [])
        .filter((message) => message.status === "queued")
        .map((message) => message.text)
        .join(" ");
      const requestText = [run.task, run.criteria, clarification].join(" ");
      if (
        !run.directPlan &&
        run.assignments.every(
          (assignment) =>
            assignment.status === "completed" && !!assignment.question,
        ) &&
        run.allowWrite &&
        builder &&
        taskComplexity(
          `${run.routingContext || ""}\n${requestText}`,
          run.references.length,
        ).level === "simple" &&
        /\b(calculat(?:or|er)|hello[ -]world|number guessing|unit converter)\b/i.test(
          requestText,
        ) &&
        (/\b(create|build|write|implement|make)\b/i.test(requestText) ||
          /^\s*calculat(?:or|er)\s*$/i.test(run.task)) &&
        !/\b(scientific|symbolic|graphing|production|database|api|deploy|plan only|read.only|do not|don't)\b/i.test(
          requestText,
        )
      ) {
        run.directPlan = {
          summary:
            "Direct specialist handoff for a small, explicit program request.",
          research: [],
          build: [
            {
              agentId: builder.id,
              objective: `Implement the user's small program request: ${run.task}.${clarification ? ` User clarification: ${clarification}.` : ""} Follow the folder and requirements in the conversation. Keep the solution focused, verify the relevant behavior, and report actual changes and checks concisely.`,
            },
          ],
        };
        this.event(
          run,
          "status",
          `Simple task handed directly to ${builder.name}; review remains required.`,
        );
        this.save(run);
      }
      let planned = run.directPlan;
      if (!planned) {
        const planOutput = await this.step(
          run,
          lead,
          "plan",
          "Plan the task. Return summary, research assignments, and build assignments. Select enabled specialists by ID. Research must use read-only agents. Build assignments must use builders. Use empty arrays when unnecessary. Do not perform implementation yourself.",
          jsonSchema,
        );
        if (clarificationQuestion(planOutput))
          throw Error("Waiting for your answer.");
        try {
          planned = planSchema.parse(
            planResult(
              planOutput,
              run.team.agents.filter((a) => a.enabled),
            ),
          );
        } catch (error) {
          if (!run.groupChat) throw error;
          // One bounded format repair: do not abandon an authorized task because
          // the coordinator replied conversationally instead of delegating.
          const repaired = await this.step(
            run,
            lead,
            "plan",
            `Repair your previous response into an actionable coordinator plan. The user request and conversation still apply. ${run.allowWrite ? "Bolt is authorized to implement; your own read-only planning stage is not a blocker." : "Keep all assignments read-only."} If the user delegated the choice, choose a sensible small solution. Return a short summary and exactly Research and Build sections, with '- agentId: objective' or 'None'. Use only enabled agent IDs from stage context. Ask a Question for you only if an essential fact still blocks progress. Do not repeat a permission refusal caused only by your planner role. Previous format error: ${String(error)}`,
          );
          planned = planResult(
            repaired,
            run.team.agents.filter((a) => a.enabled),
          );
        }
      }
      const plan = planSchema.parse(planned);
      for (const t of plan.research)
        if (this.agent(run, t.agentId).access !== "read-only")
          throw new Error("Research assignments must use read-only agents.");
      if (
        new Set(plan.research.map((t) => t.agentId)).size !==
        plan.research.length
      )
        throw new Error(
          "The lead assigned a researcher twice in the same batch. Retry with one research assignment per member.",
        );
      for (const t of plan.build)
        if (this.agent(run, t.agentId).role !== "builder")
          throw new Error("Build assignments must target builders.");
      // A shared native conversation accepts one turn at a time.
      const batchSize = run.groupChat ? 1 : 2;
      for (let i = 0; i < plan.research.length; i += batchSize) {
        const results = await Promise.allSettled(
          plan.research
            .slice(i, i + batchSize)
            .map((t) =>
              this.step(
                run,
                this.agent(run, t.agentId),
                "research",
                t.objective,
              ),
            ),
        );
        const failed = results.find((r) => r.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
      }
      for (const t of plan.build)
        await this.step(run, this.agent(run, t.agentId), "build", t.objective);
      const reviewers = run.team.agents.filter(
        (a) =>
          a.role === "reviewer" &&
          a.enabled &&
          (plan.research.length > 0 || plan.build.length > 0),
      );
      let findings: string[] = [];
      for (const reviewer of reviewers) {
        const review = reviewSchema.parse(
          reviewResult(
            await this.step(
              run,
              reviewer,
              "review",
              "Review the completed task against its acceptance criteria. Return passed and findings. Read workspace evidence; do not modify files.",
              reviewOutput,
            ),
          ),
        );
        if (!review.passed) findings.push(review.findings);
      }
      if (findings.length && plan.build.length) {
        run.revision = 1;
        this.save(run);
        for (const t of plan.build)
          await this.step(
            run,
            this.agent(run, t.agentId),
            "revise",
            `Address the review findings for your assignment. ${findings.join("\n")}`,
          );
        findings = [];
        for (const reviewer of reviewers) {
          const review = reviewSchema.parse(
            reviewResult(
              await this.step(
                run,
                reviewer,
                "review",
                "Review the revised work. This is the final automatic review. Return passed and findings.",
                reviewOutput,
              ),
            ),
          );
          if (!review.passed) findings.push(review.findings);
        }
      }
      run.result = await this.step(
        run,
        lead,
        "final",
        `${run.directPlan ? "Summarize the builder result and review verdict in at most 100 words. Include files changed, checks actually performed, and unresolved issues. Do not repeat Summary, Research, or Build headings." : "Combine team results. State what was done, evidence, artifacts, and unresolved issues."} ${findings.length ? "Unresolved review findings: " + findings.join("\n") : ""}`,
      );
      while (run.inbox?.some((message) => message.status === "queued")) {
        const pending = run.inbox.find(
          (message) => message.status === "queued",
        )!;
        run.result = await this.execute(
          run,
          lead,
          "final",
          `Reply to the new user messages (${pending.id}). Use the shared conversation and completed team results. Be clear about any further work required.`,
        );
      }
      run.status = findings.length ? "failed" : "completed";
      if (findings.length)
        run.error = "Review findings remain. User direction is required.";
      this.event(run, "result", run.result);
      this.save(run);
    } catch (e) {
      if (!this.stopping.has(run.id)) {
        const last = run.nativeTeam
          ? [...run.assignments]
              .reverse()
              .find(
                (assignment) =>
                  run.team.agents.find(
                    (agent) => agent.id === assignment.agentId,
                  )?.role === "lead",
              )
          : run.assignments.at(-1);
        const question =
          last?.status === "completed"
            ? clarificationQuestion(last.output)
            : undefined;
        if (question && last) {
          last.question = question;
          run.question = { assignmentId: last.id, text: question };
          run.status = "approval";
          run.error = undefined;
          this.event(
            run,
            "approval",
            `${this.agent(run, last.agentId).name} is asking you: ${question}`,
            last,
          );
          this.save(run);
          return;
        }
        run.status = conversationBusy(e) ? "interrupted" : "failed";
        run.error = conversationBusy(e) ? conversationBusyMessage : String(e);
        this.event(run, conversationBusy(e) ? "status" : "error", run.error);
        this.save(run);
      }
    } finally {
      this.busy.delete(run.id);
    }
  }
  async stop(run: Run, cancel = false) {
    this.stopping.add(run.id);
    this.scheduler.wake();
    const pauseGoal = async () => {
      if (run.goalInitialized && run.chatThreadId && this.runtime.setThreadGoal &&
        (await this.runtime.getThreadGoal?.(run.chatThreadId))?.status === "active")
        await this.runtime.setThreadGoal(run.chatThreadId, { status: "paused" });
    };
    clearTimeout(this.demoTimers.get(run.id));
    this.demoTimers.delete(run.id);
    const active = run.assignments.filter((a) =>
      ["queued", "running", "approval"].includes(a.status),
    );
    for (const approval of this.approvals.filter((a) => a.runId === run.id)) {
      if (!run.demo) {
        try {
          this.runtime.respond(approval.id, false);
        } catch {}
      }
    }
    this.approvals = this.approvals.filter((a) => a.runId !== run.id);
    const results = await Promise.allSettled(
      [pauseGoal(), ...active.map((a) =>
        run.demo ? Promise.resolve() : this.runtime.interrupt(a),
      )],
    );
    for (const a of active) a.status = "interrupted";
    run.status = cancel ? "cancelled" : "interrupted";
    this.event(
      run,
      "status",
      cancel
        ? "Task cancelled. Existing changes and results are preserved."
        : "Task interrupted. Existing changes and results are preserved.",
    );
    if (results.some((r) => r.status === "rejected"))
      run.error =
        "Interruption could not be confirmed. Reconcile before resuming.";
    this.save(run);
  }
  async resume(run: Run) {
    if (run.question)
      throw new Error("Reply to the team's question in chat to continue.");
    if (run.demo) throw new Error("Start a new office tour to replay it.");
    if (this.busy.has(run.id))
      throw new Error("Previous execution is still settling. Retry shortly.");
    if (
      this.runs.some(
        (r) =>
          r.id !== run.id &&
          ["running", "approval", "queued"].includes(r.status) &&
          !!run.chatThreadId &&
          r.chatThreadId === run.chatThreadId,
      )
    )
      throw new Error("Another task is active.");
    for (const a of run.assignments.filter(
      (a) =>
        a.threadId &&
        a.status === "completed" &&
        ["plan", "review"].includes(a.stage),
    )) {
      try {
        if (a.stage === "plan") planSchema.parse(planResult(a.output));
        else reviewSchema.parse(reviewResult(a.output));
      } catch {
        const r = await this.runtime.reconcile(a);
        if (r.finished) a.output = r.output;
      }
    }
    for (const a of run.assignments.filter(
      (a) => a.threadId && ["interrupted", "failed"].includes(a.status),
    )) {
      const r = await this.runtime.reconcile(a);
      if (r.status === "inProgress")
        throw new Error(
          "Codex still has an active turn. Interrupt this run before resuming.",
        );
      if (r.finished) {
        a.status = "completed";
        a.output = r.output;
      }
    }
    this.save(run);
    void this.drive(run);
  }
  continueGoal(threadId: string) {
    const run = this.runs.find(candidate => candidate.chatThreadId === threadId && candidate.options?.goalObjective);
    if (!run || run.question || this.busy.has(run.id)) return;
    if (this.runs.some(candidate => candidate.chatThreadId === threadId && this.busy.has(candidate.id))) return;
    run.goalInitialized = true;
    void this.drive(run);
  }
  approve(id: string, accept: boolean, answers?: Record<string, string>) {
    const approval = this.approvals.find((a) => a.id === id);
    if (!approval) throw new Error("Approval expired.");
    const run = this.runs.find((r) => r.id === approval.runId)!;
    if (accept && approval.questions?.some((q) => !answers?.[q.id]?.trim()))
      throw new Error("Answer each question before submitting.");
    if (!run.demo) this.runtime.respond(id, accept, answers);
    this.approvals = this.approvals.filter((a) => a.id !== id);
    const a = run.assignments.find((a) => a.id === approval.assignmentId)!;
    a.status = "running";
    run.status = this.approvals.some((a) => a.runId === run.id)
      ? "approval"
      : "running";
    this.event(
      run,
      "status",
      approval.questions
        ? "Question response sent"
        : accept
          ? "Approval accepted"
          : "Approval declined",
      a,
    );
    this.save(run);
  }
  private demo(run: Run) {
    let tick = 0;
    run.status = "running";
    const advance = () => {
      if (this.stopping.has(run.id)) return;
      const agents = run.team.agents.filter((a) => a.enabled);
      const agent = agents[Math.floor(tick / 2) % agents.length];
      if (tick >= agents.length * 2) {
        for (const a of run.assignments) a.status = "completed";
        run.status = "completed";
        run.result =
          "Office tour complete. This was simulated activity: no Codex calls were made and no workspace files were changed.";
        this.event(run, "result", run.result);
        this.save(run);
        this.demoTimers.delete(run.id);
        return;
      }
      if (tick % 2 === 0) {
        const a: Assignment = {
          id: randomUUID(),
          agentId: agent.id,
          stage:
            agent.role === "lead"
              ? "plan"
              : agent.role === "researcher"
                ? "research"
                : agent.role === "reviewer"
                  ? "review"
                  : "build",
          objective: "Simulated office tour",
          status: "running",
          output: "",
        };
        run.assignments.push(a);
        this.event(
          run,
          "status",
          `${agent.name} demonstrates ${a.stage} · simulated`,
          a,
        );
      } else {
        const a = run.assignments.at(-1)!;
        a.status = "completed";
        a.output = "Sample result — simulated.";
        this.event(run, "message", a.output, a);
      }
      tick++;
      this.save(run);
      this.demoTimers.set(run.id, setTimeout(advance, 2400));
    };
    advance();
  }
}
