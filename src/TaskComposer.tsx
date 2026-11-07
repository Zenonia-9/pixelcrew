import { draftKey, readDraft, writeDraft } from "../shared/composer-drafts";
import { release } from "../shared/release";
import { followupDelivery } from "../shared/followups";
import { ChatPermissionsContext } from "./ChatPermissions";
import { shouldInheritChatPermissions } from "../shared/chat-permissions";
import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Plus,
  X,
  Paperclip,
  Image,
  Pencil,
  Plug,
  ArrowUp,
  ChevronDown,
  Loader2,
  Mic,
  Square,
  ShieldCheck,
  LockKeyhole,
  Check,
  Settings,
  Hand,
  Brain,
  Gauge,
  MessageSquare,
  Users,
  ListTodo,
  Target,
  FolderOpen,
  CheckCircle2,
  Globe,
  Monitor,
} from "lucide-react";
import {
  isValidGoalTokenBudgetInput,
  MAX_GOAL_OBJECTIVE_LENGTH,
  type Agent,
  type CodexChat,
  type CodexProject,
  type RunOptions,
  type RuntimeStatus,
  type Team,
} from "../shared/types";
import { ContextMeter } from "./ContextMeter";
import { ModelPicker } from "./ModelPicker";
import type { ComposerPreferences } from "../shared/preferences";
import { completionAt } from "../shared/composer-completion";
import { deviceToolMentionText, deviceToolMentions, insertDeviceToolMention, removeDeviceToolMention, type DeviceToolMention } from "../shared/device-tool-mentions";
import { toggleComposerPopover, type ComposerPopover } from "../shared/composer-popover";
type Attachment = RunOptions["attachments"][number];
type Mention = RunOptions["mentions"][number] & {
  description?: string;
  source?: string;
};
function DeviceMentionPreview({ text, activeTools = [] }: { text: string; activeTools?: readonly string[] }) {
  const matches = [...text.matchAll(/(^|\s)@(browser|chrome|computer)\b/gi)];
  if (!matches.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [index, match] of matches.entries()) {
    const tokenStart = match.index! + match[1].length;
    if (tokenStart > cursor) parts.push(text.slice(cursor, tokenStart));
    const tool = match[2].toLowerCase() as DeviceToolMention;
    if (!activeTools.includes(tool)) {
      parts.push(`@${tool}`);
      cursor = tokenStart + match[2].length + 1;
      continue;
    }
    const Icon = tool === "computer" ? Monitor : Globe;
    const label = tool === "computer" ? "Computer" : tool[0].toUpperCase() + tool.slice(1);
    parts.push(<span className="composer-device-mention" contentEditable={false} key={`${tool}-${index}`}><Icon size={12} aria-hidden="true" />{label}</span>);
    cursor = tokenStart + match[2].length + 1;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
export function TaskModal({
  projects,
  selectedProject,
  sourceChat,
  team,
  models,
  busy,
  connected,
  error,
  onClose,
  onCreate,
  inline = false,
  running = false,
  accountNotice,
  followupBehavior = "queue",
  queuedMessages = [],
  onQueuedAction,
  onInterrupt,
  groupChat = false,
  allowFollowup = false,
  replyTo,
  onModeChange,
  focusOnMount = false,
  preferences,
  onPreferencesChange,
  deviceAccess = { allowChrome: false, allowWindowsComputer: false, browserAvailable: false, chromeAvailable: false, computerAvailable: false },
  teamId,
}: {
  projects: CodexProject[];
  selectedProject?: CodexProject;
  sourceChat?: CodexChat;
  team: Team;
  models: RuntimeStatus["models"];
  busy: boolean;
  connected: boolean;
  error: string;
  onClose: () => void;
  onCreate: (input: unknown) => Promise<unknown>;
  inline?: boolean;
  running?: boolean;
  accountNotice?: string;
  followupBehavior?: "queue" | "steer";
  queuedMessages?: { id: string; text: string; error?: string; preview?: string; attachments?: RunOptions["attachments"] }[];
  onQueuedAction?: (id: string, action: "steer" | "remove" | "edit", text?: string) => Promise<boolean> | boolean | void;

  onInterrupt?: () => void;
  groupChat?: boolean;
  allowFollowup?: boolean;
  replyTo?: string;
  onModeChange?: (mode: "team" | "plan" | "normal" | "goal") => void;
  focusOnMount?: boolean;
  preferences?: ComposerPreferences;
  deviceAccess?: { allowChrome: boolean; allowWindowsComputer: boolean; browserAvailable: boolean; chromeAvailable: boolean; computerAvailable: boolean };
  teamId?: string;
  onPreferencesChange?: (value: ComposerPreferences) => void;
}) {
  const storageKey = draftKey(teamId, sourceChat?.id, selectedProject?.id);
  const initialDraft = useRef(readDraft(storageKey));
  const [editingQueued, setEditingQueued] = useState<string>();
  const [queuedEditText, setQueuedEditText] = useState("");
  const [task, setTask] = useState(initialDraft.current?.text || "");
  const taskInput = useRef<HTMLTextAreaElement>(null);
  const taskPreview = useRef<HTMLDivElement>(null);
  const chatPermissions = useContext(ChatPermissionsContext);
  const permissionEdited = useRef(false);
  const [permissions, setPermissions] = useState<"ask" | "auto" | "custom">(
    preferences?.permissions || "ask",
  );
  const [activePopover, setActivePopover] = useState<ComposerPopover>(null);
  const menu = activePopover === "add";
  const permissionMenu = activePopover === "permissions";
  const modelMenu = activePopover === "model";
  const goalOptions = activePopover === "goalBudget";
  const closePopover = () => setActivePopover(null);
  const togglePopover = (popover: Exclude<ComposerPopover, null>) =>
    setActivePopover((current) => toggleComposerPopover(current, popover));
  const [completion, setCompletion] =
    useState<ReturnType<typeof completionAt>>();
  const [choice, setChoice] = useState(0);
  useEffect(() => {
    if (!activePopover) return;
    const close = (event: Event) => {
      if (event.type === "keydown" && (event as KeyboardEvent).key !== "Escape")
        return;
      if (
        event.type === "pointerdown" &&
        event.target instanceof Element &&
        event.target.closest(
          '.composer-add-menu,.model-popover,.permission-menu,.model-trigger,.team-model-trigger,.goal-budget-control,[aria-label="Add attachments and tools"],[aria-label="Permissions"]',
        )
      )
        return;
      closePopover();
      if (event.type === "keydown") event.stopImmediatePropagation();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close, true);
    };
  }, [activePopover]);
  const [delivery, setDelivery] = useState<"steer" | "queue">(followupBehavior);
  const shortcutDelivery = useRef<"steer" | "queue" | undefined>(undefined);
  useEffect(() => setDelivery(followupBehavior), [followupBehavior]);
  const sending = useRef(false);
  const [projectId, setProjectId] = useState(selectedProject?.id || "");
  const [workspace, setWorkspace] = useState(
    sourceChat?.cwd ||
      selectedProject?.roots[0] ||
      localStorage.getItem("hearth-workspace") ||
      "",
  );
  const [chats, setChats] = useState<CodexChat[]>(
      sourceChat ? [sourceChat] : [],
    ),
    [sourceId, setSourceId] = useState(sourceChat?.id || ""),
    [chatCursor, setChatCursor] = useState<string>();
  const [mode, setMode] = useState<"team" | "plan" | "normal" | "goal">(
      preferences?.mode || (inline && !groupChat ? "normal" : "team"),
    ),
    [allowWrite, setAllowWrite] = useState(preferences?.allowWrite ?? true),
    [criteria, setCriteria] = useState(initialDraft.current?.criteria || "");
  const [goalTokenBudget, setGoalTokenBudget] = useState(
    initialDraft.current?.goalTokenBudget?.toString() || "",
  );
  const ModeIcon = mode === "team" ? Users : mode === "plan" ? ListTodo : mode === "goal" ? Target : MessageSquare;
  const goalObjective = [task.trim(), criteria.trim() ? `Success criteria: ${criteria.trim()}` : ""]
    .filter(Boolean)
    .join("\n\n");
  const goalObjectiveTooLong = mode === "goal" && goalObjective.length > MAX_GOAL_OBJECTIVE_LENGTH;
  const goalTokenBudgetInvalid = mode === "goal" && !isValidGoalTokenBudgetInput(goalTokenBudget);
  useEffect(() => {
    // Saved composer choices belong to this chat (or its project default), so
    // they must win over the last turn's recorded settings. The latter are
    // only a starting point for chats without a saved choice.
    if (preferences) return;
    const live = chatPermissions?.settings;
    if (!live) return;
    if (permissionEdited.current) {
      if (
        live.allowWrite === allowWrite &&
        (!allowWrite || live.mode === permissions)
      )
        permissionEdited.current = false;
      else return;
    }
    setPermissions(live.mode);
    setAllowWrite(live.allowWrite);
  }, [chatPermissions?.settings, permissions, allowWrite]);
  const permissionsUnknown =
    !!sourceId && !permissionEdited.current && !chatPermissions?.settings;
  const permissionLabel =
    mode === "plan" || !allowWrite
      ? "Read only"
      : permissions === "ask"
        ? "Ask for approval"
        : permissions === "auto"
          ? "Approve for me"
          : "Custom permissions";
  const permissionTitle =
    sourceId && !permissionEdited.current && !chatPermissions?.settings
      ? chatPermissions?.loaded
        ? "Chat permissions unavailable; choose permissions for the next turn"
        : "Reading chat permissions…"
      : permissionEdited.current && sourceId
        ? `Next turn: ${permissionLabel}`
        : permissionLabel;
  const [references, setReferences] = useState(initialDraft.current?.references || ""),
    [attachments, setAttachments] = useState<Attachment[]>(initialDraft.current?.attachments || []),
    [mentions, setMentions] = useState<Mention[]>(initialDraft.current?.mentions || []),
    [deviceTools, setDeviceTools] = useState<RunOptions["deviceTools"]>(release.capabilities.deviceTools ? preferences?.deviceTools || initialDraft.current?.deviceTools || [] : []);
  const [deviceSessionId, setDeviceSessionId] = useState(preferences?.deviceSessionId || initialDraft.current?.deviceSessionId || crypto.randomUUID());
  useEffect(() => {
    const draft = readDraft(storageKey);
    const savedTools = release.capabilities.deviceTools ? preferences?.deviceTools || draft?.deviceTools || [] : [];
    setDeviceTools(savedTools);
    setTask(current => savedTools.reduce((text, tool) => insertDeviceToolMention(text, tool), current));
    setDeviceSessionId(preferences?.deviceSessionId || draft?.deviceSessionId || crypto.randomUUID());
  }, [storageKey, preferences?.deviceTools, preferences?.deviceSessionId]);
  useEffect(() => { writeDraft(storageKey, { text: task, criteria, references, goalTokenBudget: goalTokenBudget ? Number(goalTokenBudget) : undefined, attachments, mentions, deviceTools, deviceSessionId }); }, [storageKey, task, criteria, references, goalTokenBudget, attachments, mentions, deviceTools, deviceSessionId]);
  useEffect(() => {
    const input = taskInput.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, window.innerHeight * 0.5)}px`;
  }, [task]);
  const [files, setFiles] = useState<
    { name: string; path: string; directory: boolean }[]
  >([]);
  useEffect(() => {
    if (completion?.kind !== "@") {
      setFiles([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(
        `/api/files?workspace=${encodeURIComponent(workspace)}&query=${encodeURIComponent(completion.query)}`,
        { signal: controller.signal },
      )
        .then((response) => response.json())
        .then((data) => setFiles(Array.isArray(data.items) ? data.items : []))
        .catch(() => {});
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [completion?.kind, completion?.query, workspace]);
  const [overrides, setOverrides] = useState<RunOptions["models"]>(
    () =>
      preferences?.models ||
      Object.fromEntries(
        team.agents
          .filter((a) => a.enabled)
          .map((a) => {
            const profile = a;
            if (
              inline &&
              !groupChat &&
              a.role === "lead" &&
              sourceChat?.model &&
              models.some((m) => m.id === sourceChat.model)
            )
              return [
                a.id,
                {
                  model: sourceChat.model,
                  reasoning: sourceChat.reasoning || profile.reasoning,
                },
              ];
            return [
              a.id,
              { model: profile.model, reasoning: profile.reasoning },
            ];
          }),
      ),
  );
  const savePreferences = useRef(onPreferencesChange);
  savePreferences.current = onPreferencesChange;
  const lastPreferences = useRef(
    JSON.stringify({ mode, permissions, allowWrite, models: overrides, deviceTools, ...(sourceChat?.id ? { deviceSessionId } : {}) }),
  );
  useEffect(() => {
    const value = { mode, permissions, allowWrite, models: overrides, deviceTools, ...(sourceChat?.id ? { deviceSessionId } : {}) };
    const encoded = JSON.stringify(value);
    if (encoded === lastPreferences.current) return;
    lastPreferences.current = encoded;
    savePreferences.current?.(value);
  }, [mode, permissions, allowWrite, overrides, deviceTools, deviceSessionId, sourceChat?.id]);
  const [tools, setTools] = useState<Mention[]>([]),
    [toolsError, setToolsError] = useState("");
  const [sketch, setSketch] = useState(false),
    [uploading, setUploading] = useState(false),
    [localError, setLocalError] = useState("");
  const dialog = useRef<HTMLElement>(null),
    file = useRef<HTMLInputElement>(null),
    image = useRef<HTMLInputElement>(null);
  const state = useRef({ busy, uploading, onClose });
  state.current = { busy, uploading, onClose };
  useEffect(() => {
    const section = dialog.current;
    const choose = (event: Event) =>
      setTask(String((event as CustomEvent).detail));
    section?.addEventListener("hearth-answer", choose);
    return () => section?.removeEventListener("hearth-answer", choose);
  }, []);
  useEffect(() => {
    if (inline) return;
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !state.current.busy && !state.current.uploading)
        state.current.onClose();
      if (e.key === "Tab") {
        const elements = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), textarea, select, a[href], summary",
          ) || [],
        ).filter((e) => e.getClientRects().length);
        if (e.shiftKey && document.activeElement === elements[0]) {
          e.preventDefault();
          elements.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === elements.at(-1)) {
          e.preventDefault();
          elements[0]?.focus();
        }
      }
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", listener);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", listener);
      document
        .querySelector<HTMLButtonElement>(".top-actions .primary")
        ?.focus();
    };
  }, []);
  const lead = team.agents.find((a) => a.role === "lead" && a.enabled)!;
  const [listening, setListening] = useState(false);
  const loadChats = async (append = false) => {
    if (!projectId) {
      setChats([]);
      return;
    }
    try {
      const data = await request<{ chats: CodexChat[]; nextCursor?: string }>(
        `/chats?projectId=${encodeURIComponent(projectId)}${append && chatCursor ? `&cursor=${encodeURIComponent(chatCursor)}` : ""}`,
      );
      setChats((previous) =>
        (append
          ? [...previous, ...data.chats]
          : sourceChat?.projectId === projectId
            ? [sourceChat, ...data.chats]
            : data.chats
        ).filter((c, i, all) => all.findIndex((x) => x.id === c.id) === i),
      );
      setChatCursor(data.nextCursor);
    } catch (e) {
      setLocalError((e as Error).message);
    }
  };
  useEffect(() => {
    void loadChats();
  }, [projectId]);
  useEffect(() => {
    if (!menu && !completion) return;
    let active = true;
    setToolsError("");
    request<{ items: Mention[]; errors: string[] }>(
      `/composer?workspace=${encodeURIComponent(workspace)}`,
    )
      .then((data) => {
        if (active) {
          setTools(data.items);
          setToolsError(data.errors.join("\n"));
        }
      })
      .catch((e) => {
        if (active) setToolsError(e.message);
      });
    return () => {
      active = false;
    };
  }, [menu, !!completion, workspace]);
  const upload = async (files: File[]) => {
    if (!files.length) return false;
    if (attachments.length + files.length > 12) {
      setLocalError("Attach up to 12 files.");
      return false;
    }
    setUploading(true);
    setLocalError("");
    try {
      const added: Attachment[] = [];
      for (const f of files) {
        if (f.size > 8 * 1024 * 1024)
          throw new Error(`${f.name} exceeds 8 MB.`);
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(f);
        });
        const uploaded = await request<Attachment & { preview?: string }>("/attachments", { name: f.name, data });
        added.push({ ...uploaded, preview: f.type.startsWith("image/") ? uploaded.preview || data : undefined } as Attachment);
      }
      setAttachments((previous) => [...previous, ...added]);
      closePopover();
      return true;
    } catch (e) {
      setLocalError((e as Error).message);
      return false;
    } finally {
      setUploading(false);
    }
  };
  const toggleDeviceTool = (tool: DeviceToolMention) => {
    const selected = (deviceTools || []).includes(tool);
    setDeviceTools(previous => selected
      ? (previous || []).filter(item => item !== tool)
      : [...(previous || []), tool]);
    if (selected) setTask(current => removeDeviceToolMention(current, tool));
    else setTask(current => {
      const input = taskInput.current;
      return insertDeviceToolMention(current, tool, input?.selectionStart ?? current.length, input?.selectionEnd ?? current.length);
    });
  };
  const changeModel = (agent: Agent, model: string) => {
    const entry = models.find((m) => m.id === model);
    setOverrides((previous) => ({
      ...previous,
      [agent.id]: {
        model,
        reasoning:
          previous[agent.id]?.reasoning &&
          entry?.efforts?.includes(previous[agent.id].reasoning!)
            ? previous[agent.id].reasoning
            : undefined,
      },
    }));
  };
  const suggestions = completion
    ? [
        ...(completion.kind === "/"
          ? ["team", "plan", "normal"].map((name) => ({
              name,
              label: `${name[0].toUpperCase()}${name.slice(1)} mode`,
              kind: "command",
              path: name,
            }))
          : []),
        ...tools
          .filter((item) =>
            completion.kind === "@"
              ? item.type === "mention"
              : item.type === "skill",
          )
          .map((item) => ({ ...item, label: item.name, kind: item.type })),
        ...(completion.kind === "@"
          ? ([
              { id: "browser", name: "browser", allowed: deviceAccess.browserAvailable },
              { id: "chrome", name: "chrome", allowed: deviceAccess.allowChrome && deviceAccess.chromeAvailable },
              { id: "computer", name: "computer", allowed: deviceAccess.allowWindowsComputer && deviceAccess.computerAvailable },
            ] as const)
              .filter(tool => tool.allowed && (mode !== "plan" || tool.id === "browser"))
              .map(tool => ({
                name: tool.name,
                label: tool.name,
                kind: "device-tool",
                path: tool.id,
                description: tool.id === "browser"
                  ? "Control the in-app browser"
                  : tool.id === "chrome"
                    ? "Use your existing Chrome windows"
                    : "Use Windows apps and desktop",
              }))
          : []),
        ...(completion.kind === "@"
          ? files.map((item) => ({ ...item, label: item.name, kind: "file" }))
          : []),
      ]
        .filter((item) => item.label.toLowerCase().includes(completion.query))
        .slice(0, 30)
    : [];
  const acceptSuggestion = (item: (typeof suggestions)[number]) => {
    if (!completion) return;
    if (item.kind === "file" && item.label.endsWith("/")) {
      const next =
        task.slice(0, completion.start) +
        "@" +
        item.label +
        task.slice(completion.end);
      setTask(next);
      setCompletion(
        completionAt(next, completion.start + item.label.length + 1),
      );
      setChoice(0);
      return;
    }
    if (item.kind === "device-tool") {
      const deviceTool = item.path as DeviceToolMention;
      const next = task.slice(0, completion.start) + `@${deviceTool}` + task.slice(completion.end);
      setTask(next);
      setDeviceTools(previous => [...new Set([...(previous || []), deviceTool])]);
      setCompletion(undefined);
      return;
    }
    if (item.kind === "command") {
      setMode(item.path as "team" | "plan" | "normal" | "goal");
      onModeChange?.(item.path as "team" | "plan" | "normal" | "goal");
    } else if (item.kind === "file")
      setAttachments((previous) =>
        previous.some((attachment) => attachment.path === item.path)
          ? previous
          : [...previous, { name: item.name, path: item.path, kind: "file" }],
      );
    else
      setMentions((previous) =>
        previous.some((mention) => mention.path === item.path)
          ? previous
          : [
              ...previous,
              {
                type: item.kind as "mention" | "skill",
                name: item.name,
                path: item.path,
              },
            ],
      );
    setTask(task.slice(0, completion.start) + task.slice(completion.end));
    setCompletion(undefined);
  };
  const teamModels = (
    <div className="model-assignments">
      {team.agents
        .filter((a) => a.enabled && (mode === "team" || a.role === "lead"))
        .map((a) => {
          const entry = models.find((m) => m.id === overrides[a.id]?.model);
          return (
            <div key={a.id}>
              <span>
                {a.name}
                <small>{a.title}</small>
              </span>
              <select
                aria-label={`${a.name} model`}
                value={overrides[a.id]?.model || ""}
                onChange={(e) => changeModel(a, e.target.value)}
              >
                <option value="">Auto</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <select
                aria-label={`${a.name} reasoning`}
                value={overrides[a.id]?.reasoning || ""}
                onChange={(e) =>
                  setOverrides((previous) => ({
                    ...previous,
                    [a.id]: {
                      ...previous[a.id],
                      reasoning: e.target.value || undefined,
                    },
                  }))
                }
              >
                <option value="">Auto</option>
                {(entry?.efforts || []).map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
    </div>
  );
  return (
    <div
      className={inline ? "inline-composer" : "modal-backdrop"}
      onClick={(e) => {
        if (!inline && e.target === e.currentTarget && !busy && !uploading)
          onClose();
      }}
    >
      <section
        ref={dialog}
        role={inline ? undefined : "dialog"}
        aria-modal={inline ? undefined : true}
        aria-labelledby={inline ? undefined : "task-title"}
        aria-label={inline ? "Chat composer" : undefined}
        className={inline ? "composer-inline" : "task-modal composer-modal"}
      >
        {!inline && (
          <header className="composer-heading">
            <h2 id="task-title">New task</h2>
            <button
              disabled={busy || uploading}
              onClick={onClose}
              aria-label="Close task form"
            >
              <X size={18} />
            </button>
          </header>
        )}
        {queuedMessages.length > 0 && <div className="queued-followups" aria-label="Queued messages">{queuedMessages.map(message => <div className="queued-followup" key={message.id}>
          <span className="queue-symbol" aria-hidden="true">≡</span>
          {message.preview ? <img className="queued-image" src={message.preview} alt="Queued attachment" /> : message.attachments?.length ? <Paperclip size={13} /> : null}
          {editingQueued === message.id ? <div className="queued-message-editor"><textarea aria-label="Edit queued message" value={queuedEditText} onChange={event => setQueuedEditText(event.target.value)} /><button type="button" disabled={busy || !queuedEditText.trim()} onClick={async () => { if (await onQueuedAction?.(message.id, "edit", queuedEditText) !== false) setEditingQueued(undefined); }}>Save</button><button type="button" onClick={() => setEditingQueued(undefined)}>Cancel</button></div> : <span className="queued-followup-text" title={message.text}>{message.text}</span>}
          <button type="button" aria-label={`Edit queued message: ${message.text.slice(0, 40)}`} title="Edit message" disabled={busy} onClick={() => { setEditingQueued(message.id); setQueuedEditText(message.text); }}><Pencil size={13} /></button>
          <button type="button" title="Steer this message now" disabled={busy} onClick={() => onQueuedAction?.(message.id, "steer")}>↳ Steer</button>
          <button type="button" aria-label={`Remove queued message: ${message.text.slice(0, 40)}`} disabled={busy} onClick={() => onQueuedAction?.(message.id, "remove")}><X size={13} /></button>
          {message.error && <small role="status">{message.error}</small>}
        </div>)}</div>}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (goalObjectiveTooLong || goalTokenBudgetInvalid) {
              if (goalTokenBudgetInvalid) {
                setActivePopover("goalBudget");
                setLocalError("Token budget must be a positive whole number.");
                return;
              }
              setLocalError(`Goal objectives can be up to ${MAX_GOAL_OBJECTIVE_LENGTH.toLocaleString()} characters.`);
              return;
            }
            if (
              sending.current ||
              busy ||
              uploading ||
              listening ||
              !connected ||
              !task.trim()
            )
              return;
            sending.current = true;
            try {
              setLocalError("");
              localStorage.setItem("hearth-workspace", workspace);
              const sent = await onCreate({
                task,
                workspace,
                criteria,
                references: references
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
                allowWrite: mode !== "plan" && allowWrite,
                options: {
                  teamId,
                  projectId: projectId || undefined,
                  sourceThreadId: sourceId || undefined,
                  continueSourceThread: mode === "normal" && groupChat && !!sourceId,
                  mode: mode === "goal" ? "normal" : mode,
                  goalObjective: mode === "goal" ? goalObjective : undefined,
                  goalTokenBudget: mode === "goal" && goalTokenBudget ? Number(goalTokenBudget) : undefined,
                  permissions,
                  inheritPermissions:
                    shouldInheritChatPermissions(sourceId, permissionEdited.current),
                  delivery: shortcutDelivery.current || delivery,
                  models: overrides,
                  attachments,
                  mentions,
                  deviceTools: (deviceTools || []).filter(tool => tool === "browser" || (tool === "chrome" && deviceAccess.allowChrome) || (tool === "computer" && deviceAccess.allowWindowsComputer)).filter(tool => mode !== "plan" || tool === "browser"),
                  deviceSessionId,
                },
              });
              if (sent) {
                if (mode === "goal") {
                  setMode("normal");
                  setGoalTokenBudget("");
                  closePopover();
                }
                const saved = readDraft(storageKey);
                const selectedToolMentions = deviceToolMentionText(deviceTools || []);
                if (saved?.text === task) writeDraft(storageKey, { text: selectedToolMentions, criteria: "", references: "", attachments: [], mentions: [], deviceTools, deviceSessionId });
                setCriteria(current => current === criteria ? "" : current);
                setReferences(current => current === references ? "" : current);
                setTask(current => current === task ? selectedToolMentions : current);
                setAttachments(current => current.filter(item => !attachments.some(sent => sent.path === item.path)));
                setMentions(current => current.filter(item => !mentions.some(sent => sent.path === item.path)));
                if (!sourceChat?.id) setDeviceSessionId(crypto.randomUUID());
              }
            } catch (error) {
              setLocalError((error as Error).message);
            } finally {
              sending.current = false;
              shortcutDelivery.current = undefined;
            }
          }}
        >
          {!inline && (
            <div className="composer-context">
              <select
                aria-label="Codex project"
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setSourceId("");
                  const p = projects.find((p) => p.id === e.target.value);
                  if (p?.roots[0]) setWorkspace(p.roots[0]);
                }}
              >
                <option value="">Custom workspace</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.roots.length}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Existing chat"
                value={sourceId}
                disabled={!projectId}
                onChange={(e) => {
                  setSourceId(e.target.value);
                  const chat = chats.find((c) => c.id === e.target.value);
                  if (chat) setWorkspace(chat.cwd);
                }}
              >
                <option value="">New conversations</option>
                {chats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {chatCursor && (
                <button
                  type="button"
                  className="quiet"
                  onClick={() => void loadChats(true)}
                >
                  More chats
                </button>
              )}
            </div>
          )}
          {sourceId && !inline && (
            <p className="form-help">
              {mode === "goal"
                ? "Set or update the goal for this chat."
                : mode === "normal"
                  ? "Continue this chat."
                : "Continue with your team in this chat."}
            </p>
          )}
          {accountNotice && <p className="running-account-note" role="status">{accountNotice}</p>}
          <div className="composer-input">
            {completion && (
              <div
                className="composer-completions"
                role="listbox"
                aria-label="Composer suggestions"
              >
                <small>
                  {completion.kind === "@"
                    ? "Files & apps"
                    : completion.kind === "$"
                      ? "Skills"
                      : "Commands & skills"}
                </small>
                {suggestions.map((item, index) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === choice}
                    key={item.path}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => acceptSuggestion(item)}
                  >
                    {item.kind === "device-tool"
                      ? item.path === "computer" ? <Monitor size={15} /> : <Globe size={15} />
                      : <Plug size={15} />}
                    <span>
                      {item.kind === "device-tool" ? item.label[0].toUpperCase() + item.label.slice(1) : item.label}
                      {"description" in item &&
                        typeof item.description === "string" &&
                        item.description && (
                          <small className="completion-description">
                            {item.description}
                          </small>
                        )}
                    </span>
                    <small>{item.kind}</small>
                  </button>
                ))}
                {!suggestions.length && <p>{toolsError || "No matches"}</p>}
              </div>
            )}
            {(attachments.length > 0 || mentions.length > 0) && (
              <div className="attachment-chips">
                {attachments.map((a) => (
                  <span key={a.path} className={a.kind === "image" ? "composer-image-attachment" : ""}>
                    {a.kind === "image" && (a as Attachment & { preview?: string }).preview ? <img src={(a as Attachment & { preview?: string }).preview} alt={a.name} /> : <Paperclip size={12} />}
                    <span>{a.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${a.name}`}
                      onClick={() =>
                        setAttachments(
                          attachments.filter((x) => x.path !== a.path),
                        )
                      }
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
                {mentions.map((m) => (
                  <span key={m.path}>
                    <Plug size={12} />
                    {m.name}
                    <button
                      type="button"
                      aria-label={`Remove ${m.name}`}
                      onClick={() =>
                        setMentions(mentions.filter((x) => x.path !== m.path))
                      }
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="composer-editor">
            <div className="composer-editor-preview" aria-hidden="true" ref={taskPreview}><DeviceMentionPreview text={task} activeTools={deviceTools} /></div>
            <textarea
              ref={taskInput}
              autoFocus={!inline || focusOnMount}
              aria-label="Your task"
              required
              value={task}
              rows={inline ? 2 : 3}
              placeholder={
                replyTo
                  ? `Reply to ${replyTo}…`
                  : mode === "normal"
                    ? "Work with Codex"
                    : mode === "plan"
                    ? "What would you like to plan?"
                    : mode === "goal"
                      ? "Describe the outcome you want…"
                      : "What should the team work on?"
              }
              onChange={(e) => {
                const next = e.target.value;
                setTask(next);
                setDeviceTools(deviceToolMentions(next).filter(tool =>
                  tool === "browser"
                    ? deviceAccess.browserAvailable
                    : tool === "chrome"
                      ? deviceAccess.allowChrome && deviceAccess.chromeAvailable
                      : deviceAccess.allowWindowsComputer && deviceAccess.computerAvailable,
                ));
                setCompletion(
                  completionAt(next, e.target.selectionStart),
                );
                setChoice(0);
              }}
              onScroll={(event) => {
                if (taskPreview.current) taskPreview.current.scrollTop = event.currentTarget.scrollTop;
              }}
              onKeyDown={(e) => {
                if (completion && !e.ctrlKey && !e.metaKey) {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setCompletion(undefined);
                    return;
                  }
                  if (["ArrowDown", "ArrowUp"].includes(e.key)) {
                    e.preventDefault();
                    setChoice((previous) =>
                      suggestions.length
                        ? (previous +
                            (e.key === "ArrowDown" ? 1 : -1) +
                            suggestions.length) %
                          suggestions.length
                        : 0,
                    );
                    return;
                  }
                  if (["Enter", "Tab"].includes(e.key) && suggestions.length) {
                    e.preventDefault();
                    acceptSuggestion(
                      suggestions[Math.min(choice, suggestions.length - 1)],
                    );
                    return;
                  }
                }
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  if (
                    task.trim() &&
                    !busy &&
                    !uploading &&
                    !listening &&
                    connected
                  ) {
                    const form = e.currentTarget.form;
                    const submitter =
                      running && !replyTo
                        ? form?.querySelector<HTMLButtonElement>(
                            "[data-followup-send]",
                          )
                        : undefined;
                    if (running && !replyTo && !submitter) {
                      setLocalError(
                        "Open the running chat to queue or steer a message.",
                      );
                      return;
                    }
                    setCompletion(undefined);
                    shortcutDelivery.current = running ? followupDelivery(delivery, e.ctrlKey || e.metaKey) : undefined;
                    form?.requestSubmit(submitter || undefined);
                  }
                }
              }}
              onBlur={() => setCompletion(undefined)}
              onPaste={(e) => {
                const images = Array.from(e.clipboardData.files).filter((f) =>
                  f.type.startsWith("image/"),
                );
                if (images.length) {
                  e.preventDefault();
                  void upload(images);
                  return;
                }
                const pastedText = e.clipboardData.getData("text/plain");
                if (pastedText.length > 12000) {
                  e.preventDefault();
                  const input = taskInput.current;
                  const start = input?.selectionStart ?? task.length;
                  const end = input?.selectionEnd ?? start;
                  const file = new File([pastedText], "pasted-text.txt", { type: "text/plain" });
                  void upload([file]).then((uploaded) => {
                    if (uploaded) setTask((current) => `${current.slice(0, start)}[Attached pasted text: pasted-text.txt]${current.slice(end)}`);
                  });
                }
              }}
            />
            </div>
            {goalObjectiveTooLong && <p className="goal-mode-hint invalid" role="alert">Keep the goal within {MAX_GOAL_OBJECTIVE_LENGTH.toLocaleString()} characters.</p>}
            <div className="composer-toolbar">
              <button
                type="button"
                aria-label="Add attachments and tools"
                aria-expanded={menu}
                disabled={uploading}
                onClick={() => {
                  togglePopover("add");
                }}
              >
                {uploading ? (
                  <Loader2 size={18} className="spin" />
                ) : (
                  <Plus size={19} />
                )}
              </button>
              <div className="task-mode-control" title={`Mode: ${mode[0].toUpperCase()}${mode.slice(1)}`}>
                <ModeIcon className="task-mode-icon" size={17} aria-hidden="true" />
                <select
                aria-label="Task mode"
                value={mode}
                onChange={(e) => {
                  const next = e.target.value as "team" | "plan" | "normal" | "goal";
                  setMode(next);
                  onModeChange?.(next);
                }}
              >
                <option value="team">Team</option>
                <option value="plan">Plan</option>
                <option value="normal">Normal</option>
                <option value="goal">Goal</option>
              </select>
              </div>
              <button
                type="button"
                className={`workspace-access-indicator ${mode === "plan" || !allowWrite ? "read-only" : "edits-allowed"}`}
                aria-label={permissionsUnknown ? "Workspace access unknown" : mode === "plan" || !allowWrite ? "Workspace read only" : "Workspace edits allowed"}
                title={permissionsUnknown ? "Choose workspace access for the next turn" : mode === "plan" ? "Plan mode is read only" : allowWrite ? "Workspace edits allowed. Click to disable." : "Workspace read only. Click to allow edits."}
                disabled={mode === "plan"}
                onClick={() => { permissionEdited.current = true; setAllowWrite(!allowWrite); }}
              >
                {mode === "plan" || !allowWrite ? <LockKeyhole size={15} /> : <Pencil size={15} />}
                <span>{permissionsUnknown ? "Access unknown" : mode === "plan" || !allowWrite ? "Read only" : "Edits allowed"}</span>
              </button>
              <div className="permission-control">
                <button
                  type="button"
                  aria-label="Permissions"
                  title={permissionTitle}
                  aria-expanded={permissionMenu}
                  onClick={() => {
                    togglePopover("permissions");
                  }}
                >
                  {permissionsUnknown ? (
                    <Settings size={15} />
                  ) : permissions === "ask" ? (
                    <Hand size={15} />
                  ) : permissions === "auto" ? (
                    <ShieldCheck size={15} />
                  ) : (
                    <Settings size={15} />
                  )}
                  <span className="permission-label">
                    {permissionsUnknown
                      ? chatPermissions?.loaded
                        ? "Permissions unavailable"
                        : "Reading permissions…"
                      : permissionLabel}
                  </span>
                </button>
                {permissionMenu && (
                  <div
                    className="permission-menu"
                    role="group"
                    aria-label="Permission settings"
                  >
                    <p className="permission-heading">
                      {sourceId && chatPermissions?.settings
                        ? `${chatPermissions.active ? "Current turn" : "Last recorded turn"} in Codex: ${chatPermissions.settings.mode === "auto" ? "Approve for me" : chatPermissions.settings.mode === "ask" ? "Ask for approval" : "Custom permissions"}. Changes apply on your next send.`
                        : "How should actions be approved?"}
                    </p>
                    {(
                      [
                        [
                          "ask",
                          "Ask for approval",
                          "Ask before commands that need approval.",
                        ],
                        [
                          "auto",
                          "Approve for me",
                          "Codex reviews requests and asks when needed.",
                        ],
                        [
                          "custom",
                          "Custom (config.toml)",
                          "Use approval settings from your Codex configuration.",
                        ],
                      ] as const
                    ).map(([value, label, description]) => (
                      <button
                        type="button"
                        key={value}
                        aria-pressed={permissions === value}
                        onClick={() => {
                          permissionEdited.current = true;
                          setPermissions(value);
                          setAllowWrite(true);
                          closePopover();
                        }}
                      >
                        {value === "ask" ? (
                          <Hand size={16} />
                        ) : value === "auto" ? (
                          <ShieldCheck size={16} />
                        ) : (
                          <Settings size={16} />
                        )}
                        <span className="permission-copy">
                          <strong>{label}</strong>
                          <small>{description}</small>
                        </span>
                        {permissions === value && <Check size={15} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {mode === "goal" && <div className="goal-budget-control">
                <button type="button" className="goal-budget-trigger" aria-label="Goal budget options" aria-expanded={goalOptions} title={goalTokenBudget ? `Token budget: ${Number(goalTokenBudget).toLocaleString()}` : "Set an optional token budget"} onClick={() => togglePopover("goalBudget")}>
                  <Gauge size={16} /><span>{goalTokenBudget ? new Intl.NumberFormat(undefined, { notation: "compact" }).format(Number(goalTokenBudget)) : "Budget"}</span>
                </button>
                {goalOptions && <div className="goal-budget-popover">
                  <label htmlFor={`goal-budget-${storageKey}`}>Token budget <span>Optional</span></label>
                  <input id={`goal-budget-${storageKey}`} type="number" min="1" step="1" inputMode="numeric" aria-label="Goal token budget" placeholder="No budget" value={goalTokenBudget} onChange={event => setGoalTokenBudget(event.target.value)} />
                  <small className={goalTokenBudgetInvalid ? "goal-budget-error" : ""}>{goalTokenBudgetInvalid ? "Use a positive whole number." : "Stops when this budget is reached."}</small>
                </div>}
              </div>}
              {mode !== "team" && (
                <ModelPicker
                  models={models}
                  model={overrides[lead.id]?.model || ""}
                  effort={overrides[lead.id]?.reasoning}
                  open={modelMenu}
                  onToggle={() => {
                    togglePopover("model");
                  }}
                  onClose={closePopover}
                  onChange={(model, reasoning) =>
                    setOverrides((previous) => ({
                      ...previous,
                      [lead.id]: { model, reasoning },
                    }))
                  }
                />
              )}
              {mode === "team" && (
                <div className="direct-model-controls">
                  <button
                    type="button"
                    className="team-model-trigger"
                    aria-label="Team models and effort"
                    aria-expanded={modelMenu}
                    onClick={() => {
                      togglePopover("model");
                    }}
                  >
                    <Brain size={18} className="model-compact-icon" />
                    <span className="model-name">
                      {overrides[lead.id]?.model
                        ? models.find(
                            (model) => model.id === overrides[lead.id]?.model,
                          )?.label || overrides[lead.id].model
                        : "Auto models"}
                    </span>
                    <span className="model-effort">
                      {overrides[lead.id]?.reasoning || "Auto effort"}
                    </span>
                    <ChevronDown size={12} />
                  </button>
                  {modelMenu && (
                    <div
                      className="model-popover team-model-popover"
                      role="group"
                      aria-label="Team model settings"
                    >
                      {teamModels}
                    </div>
                  )}
                </div>
              )}
              <ContextMeter />
              <Dictation
                onText={(text) =>
                  setTask((previous) =>
                    previous ? `${previous} ${text}` : text,
                  )
                }
                onError={setLocalError}
                onListening={setListening}
              />
              {running && !replyTo && allowFollowup && task.trim() && (
                <>
                  <select
                    aria-label="Message delivery"
                    value={delivery}
                    onChange={(e) =>
                      setDelivery(e.target.value as "steer" | "queue")
                    }
                  >
                    <option value="steer">Steer</option>
                    <option value="queue">Queue</option>
                  </select>
                  <button
                    type="submit"
                    className="quiet"
                    data-followup-send
                    title={`Enter to ${delivery}; Ctrl+Enter to ${delivery === "queue" ? "steer" : "queue"}`}
                    disabled={busy || uploading || listening || !connected || goalObjectiveTooLong || goalTokenBudgetInvalid}
                    aria-label={
                      delivery === "steer"
                        ? "Steer current work"
                        : "Queue message"
                    }
                  >
                    <ArrowUp size={18} />
                  </button>
                </>
              )}
              {running && onInterrupt && !replyTo ? (
                <button
                  type="button"
                  className="primary submit-task stop-task"
                  title="Stop current work"
                  disabled={busy}
                  aria-label="Stop current work"
                  onClick={onInterrupt}
                >
                  <Square size={14} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="submit"
                  className="primary submit-task"
                  aria-label={
                    replyTo ? `Send reply to ${replyTo}` : "Start task"
                  }
                  disabled={
                    busy ||
                    uploading ||
                    listening ||
                    (running && !replyTo && !allowFollowup) ||
                    !connected ||
                    !task.trim() ||
                    goalObjectiveTooLong ||
                    goalTokenBudgetInvalid
                  }
                >
                  <ArrowUp size={19} />
                </button>
              )}
            </div>
            {menu && (
              <div className="composer-add-menu">
                <button type="button" onClick={() => file.current?.click()}>
                  <Paperclip size={16} />
                  Files
                </button>
                <button type="button" onClick={() => image.current?.click()}>
                  <Image size={16} />
                  Image or snapshot
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSketch(true);
                    closePopover();
                  }}
                >
                  <Pencil size={16} />
                  Sketch
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("plan");
                    closePopover();
                  }}
                >
                  <Pencil size={16} />
                  Plan mode
                </button>
                <div className="composer-tools">
                  {release.capabilities.deviceTools && <><p className="muted">Browser & computer tools</p>
                  {([
                    { id: "browser", name: "Browser", allowed: deviceAccess.browserAvailable, description: deviceAccess.browserAvailable ? "Private browser profile for this chat" : "Install Chrome or Edge to enable the isolated browser", Icon: Globe },
                    { id: "chrome", name: "Chrome", allowed: deviceAccess.allowChrome && deviceAccess.chromeAvailable, description: !deviceAccess.allowChrome ? "Enable Chrome access in Settings → General" : deviceAccess.chromeAvailable ? "Use your existing Chrome windows" : "Connect Computer Use in Codex desktop", Icon: Globe },
                    { id: "computer", name: "Windows computer", allowed: deviceAccess.allowWindowsComputer && deviceAccess.computerAvailable, description: !deviceAccess.allowWindowsComputer ? "Enable Windows access in Settings → General" : deviceAccess.computerAvailable ? "Use Windows apps and desktop" : "Connect Computer Use in Codex desktop", Icon: Monitor },
                  ] as const).map(({ id, name, allowed, description, Icon }) => {
                    const selected = (deviceTools || []).includes(id);
                    const modeBlocked = mode === "plan" && id !== "browser";
                    return <button type="button" className={selected ? "device-tool-selected" : ""} key={id} title={description} disabled={!allowed || modeBlocked} aria-pressed={selected} onClick={() => toggleDeviceTool(id)}>
                      <Icon size={14} />{name}{selected ? <Check size={14} /> : null}
                    </button>;
                  })}
                  <small className="muted">Navigation and input actions require approval. Chrome and Windows access is limited to one task at a time.</small></>}
                  <p className="muted">Apps & skills</p>
                  {tools.length ? (
                    tools.map((t) => (
                      <button
                        type="button"
                        key={t.path}
                        onClick={() => {
                          setMentions((previous) =>
                            previous.some((m) => m.path === t.path)
                              ? previous
                              : [...previous, t],
                          );
                          closePopover();
                        }}
                      >
                        <Plug size={14} />
                        {t.name}
                      </button>
                    ))
                  ) : (
                    <p className="muted">
                      {toolsError
                        ? "Tools unavailable in this runtime."
                        : "Loading tools…"}
                    </p>
                  )}
                  {toolsError && <p className="error-text">{toolsError}</p>}
                </div>
              </div>
            )}
          </div>
          <input
            ref={file}
            type="file"
            multiple
            hidden
            aria-label="Attach files"
            onChange={(e) => {
              void upload(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
          <input
            ref={image}
            type="file"
            multiple
            hidden
            accept="image/png,image/jpeg,image/webp,image/gif"
            aria-label="Attach images"
            onChange={(e) => {
              void upload(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
          {sketch && (
            <Sketch
              onCancel={() => setSketch(false)}
              onAttach={async (blob) => {
                setSketch(false);
                await upload([
                  new File([blob], "sketch.png", { type: "image/png" }),
                ]);
              }}
            />
          )}
          {mode === "plan" && sourceId && !running && <div className="plan-implementation-options" aria-label="Implement the plan">
            <span>After planning, implement with:</span>
            {(["normal", "team"] as const).map(next => <button type="button" key={next} onClick={() => {
              setMode(next); onModeChange?.(next); permissionEdited.current = true; setAllowWrite(true);
              if (!task.trim()) setTask("Implement the agreed plan from this conversation.");
              dialog.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
            }}>{next === "normal" ? "Normal / Nova" : "Team"}</button>)}
          </div>}
          <details className="composer-details">
            <summary><FolderOpen size={14} /><span>Task setup</span><small>{workspace.split(/[\\/]/).filter(Boolean).at(-1) || "Choose workspace"}</small><ChevronDown size={13} /></summary>
            <div className="task-setup-content">
            <section className="task-setup-card">
              <header><FolderOpen size={15} /><strong>Workspace</strong><span>{mode === "plan" || !allowWrite ? "Read only" : "Edits allowed"}</span></header>
            <label className="workspace-path-field">
              Folder
              <input required aria-label="Workspace folder" placeholder="Select a local project folder" value={workspace} onChange={e => setWorkspace(e.target.value)} />
            </label>
            <label className="workspace-edit-toggle">
              <span><strong>Allow edits</strong><small>{mode === "plan" ? "Plan mode uses read-only access." : "Let Codex change files in this workspace."}</small></span>
              <input
                type="checkbox"
                role="switch"
                aria-label="Allow workspace edits"
                checked={allowWrite && mode !== "plan"}
                disabled={mode === "plan"}
                onChange={(event) => {
                  permissionEdited.current = true;
                  setAllowWrite(event.target.checked);
                }}
              />
            </label>
            </section>
            <section className="task-setup-card">
              <header><CheckCircle2 size={15} /><strong>Completion criteria</strong><span>Optional</span></header>
            <label className="setup-field">
              <span className="sr-only">Done when</span>
              <textarea
                aria-label="Done when"
                rows={2}
                placeholder="What must be true when this task is finished?"
                value={criteria}
                onChange={(e) => setCriteria(e.target.value)}
              />
            </label>
            </section>
            <section className="task-setup-card">
              <header><Paperclip size={15} /><strong>Reference paths</strong><span>Optional</span></header>
            <label className="setup-field">
              <span className="sr-only">Files and folders</span>
              <textarea
                aria-label="Files and folders"
                rows={2}
                placeholder="Paste file or folder paths, one per line"
                value={references}
                onChange={(e) => setReferences(e.target.value)}
              />
            </label>
            </section>
            </div>
          </details>
          {(localError || error) && (
            <p className="error-text" role="alert">
              {localError || error}
            </p>
          )}
          {!connected && (
            <p className="error-text">
              Connect Codex in Settings before starting.
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
type SpeechSession = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
export function Dictation({
  onText,
  onError,
  onListening,
}: {
  onText: (text: string) => void;
  onError: (message: string) => void;
  onListening: (value: boolean) => void;
}) {
  const speech = useRef<SpeechSession | undefined>(undefined),
    [active, setActive] = useState(false),
    [interim, setInterim] = useState("");
  useEffect(
    () => () => {
      speech.current?.abort();
    },
    [],
  );
  const toggle = () => {
    if (active) {
      speech.current?.stop();
      return;
    }
    const surface = window as typeof window & {
      SpeechRecognition?: new () => SpeechSession;
      webkitSpeechRecognition?: new () => SpeechSession;
    };
    const Constructor =
      surface.SpeechRecognition || surface.webkitSpeechRecognition;
    if (!Constructor) {
      onError(
        "Dictation is unavailable in this browser. Open Studio in Chrome or Edge to use the microphone.",
      );
      return;
    }
    try {
      const recognition = new Constructor();
      speech.current = recognition;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language;
      recognition.onresult = (event) => {
        let draft = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) onText(result[0].transcript.trim());
          else draft += result[0].transcript;
        }
        setInterim(draft);
      };
      recognition.onerror = (event) => {
        onError(
          event.error === "not-allowed"
            ? "Microphone access was denied. Allow microphone access in your browser's site settings."
            : `Dictation stopped: ${event.error}`,
        );
      };
      recognition.onend = () => {
        setActive(false);
        setInterim("");
        onListening(false);
      };
      recognition.start();
      setActive(true);
      onListening(true);
      onError("");
    } catch (e) {
      setActive(false);
      onListening(false);
      onError((e as Error).message);
    }
  };
  return (
    <>
      <button
        type="button"
        className={`dictation-button ${active ? "listening" : ""}`}
        aria-label={active ? "Stop dictation" : "Dictate"}
        aria-pressed={active}
        title={
          active
            ? "Stop dictation"
            : "Dictate using your browser's speech recognition"
        }
        onClick={toggle}
      >
        {active ? <Square size={14} fill="currentColor" /> : <Mic size={17} />}
      </button>
      {active && (
        <span className="dictation-status" role="status">
          {interim || "Listening…"}
        </span>
      )}
    </>
  );
}
function Sketch({
  onAttach,
  onCancel,
}: {
  onAttach: (blob: Blob) => void;
  onCancel: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    drawing = useRef(false),
    previous = useRef<{ x: number; y: number } | undefined>(undefined);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (context) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, 640, 280);
    }
  }, []);
  return (
    <div className="sketch-editor">
      <canvas
        ref={canvas}
        width={640}
        height={280}
        aria-label="Sketch canvas"
        onPointerDown={(e) => {
          drawing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          previous.current = undefined;
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const rect = e.currentTarget.getBoundingClientRect(),
            p = {
              x: ((e.clientX - rect.left) * 640) / rect.width,
              y: ((e.clientY - rect.top) * 280) / rect.height,
            },
            context = e.currentTarget.getContext("2d");
          if (context) {
            context.strokeStyle = "#202020";
            context.lineWidth = 3;
            context.lineCap = "round";
            context.beginPath();
            context.moveTo(
              previous.current?.x || p.x,
              previous.current?.y || p.y,
            );
            context.lineTo(p.x, p.y);
            context.stroke();
          }
          previous.current = p;
        }}
        onPointerUp={() => {
          drawing.current = false;
        }}
        onPointerCancel={() => {
          drawing.current = false;
        }}
      />
      <div className="button-row">
        <button
          type="button"
          className="secondary"
          onClick={() =>
            canvas.current?.toBlob((blob) => {
              if (blob) onAttach(blob);
            }, "image/png")
          }
        >
          Attach sketch
        </button>
        <button
          type="button"
          className="quiet"
          onClick={() => {
            const c = canvas.current?.getContext("2d");
            if (c) {
              c.fillStyle = "#fff";
              c.fillRect(0, 0, 640, 280);
            }
          }}
        >
          Clear
        </button>
        <button type="button" className="quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
