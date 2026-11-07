import { UsageResetDialog } from "./UsageResetDialog";
import { release } from "../shared/release";
import { LogoutDialog } from "./LogoutDialog";
import { UsageSettings } from "./UsageSettings";
import { createdTaskDestination } from "../shared/created-task-navigation";
import { MemberEditor } from "./MemberEditor";
import { roomPlans, officeRoomPlanId } from "../shared/office-rooms";
import { TeamMembers } from "./TeamMembers";
import { AppearancePicker } from "./AppearancePicker";
import { spriteAsset } from "../shared/character-assets";
import { TeamPicker } from "./TeamPicker";
import { officeDesigns } from "../shared/office-designs";
import { useEffect, useRef, useState } from "react";
import {
  Armchair,
  ClipboardList,
  Settings,
  Plus,
  ArrowUpRight,
  ChevronRight,
  ChevronDown,
  Play,
  Pause,
  Square,
  RotateCw,
  X,
  Check,
  Download,
  Upload,
  VolumeX,
  Sparkles,
  BookOpen,
  ShieldCheck,
  Terminal,
  FolderOpen,
  Radio,
  Copy,
  Trash2,
  CheckCircle2,
  AlertCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  PanelRightClose,
  PanelBottom,
  MessageCircle,
  Users,
  LogOut,
  LogIn,
} from "lucide-react";
import type {
  Agent,
  Approval,
  CodexProject,
  CodexChat,
  CharacterState,
  Run,
  Snapshot,
  Team,
} from "../shared/types";
import { states } from "../shared/types";
import { normalAgent } from "../shared/normal-agent";
import { composerKey } from "../shared/preferences";
import { officeLayouts } from "../shared/office-layouts";
import { officeRunIndicator } from "../shared/office-life";
import { Office } from "./Office";
import { AccountUsage } from "./AccountUsage";
import { ProjectTree } from "./ProjectTree";
import { ChatView } from "./ChatView";
import { GroupChat } from "./GroupChat";
import { completedBoardTasks } from "../shared/group-chat";
import { getReadBoardPins, getReadCompletedChats, markBoardPinsRead, markCompletedChatRead } from "../shared/completion-notifications";
import { Markdown, Usage, durationLabel } from "./ChatThread";
import { TaskModal } from "./TaskComposer";
import { QuestionCard } from "./QuestionCard";
import { questionChoices } from "../shared/chat-presentation";
import { resolveProfile, preferredModel } from "../shared/models";
import { projectContains } from "../shared/projects";
import {
  sidebarSize,
  profileSize,
  SIDEBAR_RAIL_WIDTH,
  MIN_INSPECTOR_WIDTH,
} from "../shared/panel-layout";
type Page = "Office" | "Tasks" | "Settings" | "Chat";
const pages = [
  { name: "Office", icon: Armchair },
  { name: "Tasks", icon: ClipboardList },
  { name: "Settings", icon: Settings },
] as const;
const descriptions: Record<string, string> = {
  atlas: "Owl mage",
  pip: "Fox explorer",
  bolt: "Little robot",
  mira: "Cat alchemist",
  nova: "Violet robot",
};
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch("/api" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
function Portrait({ agent, size = 48 }: { agent: Agent; size?: number }) {
  return (
    <span
      className="portrait"
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${spriteAsset(agent)})`,
        backgroundSize: `${size * 8}px ${size}px`,
      }}
      role="img"
      aria-label={descriptions[agent.sprite]}
    />
  );
}
function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status}`}>
      <i className={`status-dot ${status}`} />
      {status.replaceAll("-", " ")}
    </span>
  );
}
function derive(run?: Run): Record<string, CharacterState> {
  const map: Record<string, CharacterState> = {};
  if (!run) return map;
  for (const a of run.assignments) {
    map[a.agentId] =
      a.status === "running"
        ? a.stage === "plan"
          ? "planning"
          : "working"
        : a.status === "approval"
          ? "approval"
          : a.status === "completed"
            ? "completed"
            : a.status === "failed"
              ? "failed"
              : a.status === "interrupted"
                ? "interrupted"
                : "waiting";
  }
  const asking = run.assignments.find(
    (a) => a.id === run.question?.assignmentId,
  );
  if (asking) map[asking.agentId] = "approval";
  return map;
}
export function App() {
  const [logoutPrompt, setLogoutPrompt] = useState<{ account: string; resolve: (confirmed: boolean) => void }>();
  const [usageResetsOpen, setUsageResetsOpen] = useState(false);
  const accountMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeAccount = (event: Event) => {
      if (event.type === "keydown" && (event as KeyboardEvent).key !== "Escape") return;
      if ((event.type === "pointerdown" || event.type === "click") && accountMenu.current?.contains(event.target as Node)) return;
      if (accountMenu.current) accountMenu.current.open = false;
    };
    document.addEventListener("pointerdown", closeAccount);
    document.addEventListener("click", closeAccount);
    document.addEventListener("keydown", closeAccount);
    return () => {
      document.removeEventListener("pointerdown", closeAccount);
      document.removeEventListener("click", closeAccount);
      document.removeEventListener("keydown", closeAccount);
    };
  }, []);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    sidebarSize(Number(localStorage.getItem("hearth-sidebar-width")) || 260),
  );
  const [compactViewport, setCompactViewport] = useState(() => window.matchMedia("(max-width:760px), (max-height:500px) and (max-width:1024px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width:760px), (max-height:500px) and (max-width:1024px)");
    const update = () => setCompactViewport(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const sidebarCompact = compactViewport || sidebarWidth === SIDEBAR_RAIL_WIDTH;
  const [railProjectsOpen, setRailProjectsOpen] = useState(false);
  const [projectsFocused, setProjectsFocused] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  useEffect(() => {
    const outside = (event: Event) => {
      const target = event.target as Element;
      if (!target.closest('.sidebar-task-list,[aria-label="Tasks"]'))
        setTasksOpen(false);
      if (!target.closest(".sidebar-projects,.rail-projects")) {
        setRailProjectsOpen(false);
        if (sidebarCompact) {
          setProjectsFocused(false);
        }
      }
      if (
        !target.closest(
          ".agent-location,.furniture-hit,.sidebar,.inspector-pane,.profile-resizer,.modal-backdrop,.topbar,.office-controls,.arrange-tools",
        )
      )
        setSelected(undefined);
    };
    document.addEventListener("pointerdown", outside);
    // Inspect pointer-down before React replaces or removes the clicked control.
    return () => {
      document.removeEventListener("pointerdown", outside);
    };
  }, [sidebarCompact]);
  const [profileHidden, setProfileHidden] = useState(
    () => localStorage.getItem("hearth-profile-hidden") === "true",
  );
  const [activityVisible, setActivityVisible] = useState(
    () => localStorage.getItem("hearth-activity-visible") !== "false",
  );
  const [profileWidth, setProfileWidth] = useState(
    () =>
      Number(localStorage.getItem("hearth-profile-width")) ||
      MIN_INSPECTOR_WIDTH,
  );
  const profileDrag = useRef<{ x: number; width: number } | undefined>(
    undefined,
  );
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const sidebarDrag = useRef<{ x: number; width: number } | undefined>(
    undefined,
  );
  const resizeSidebar = (width: number) => {
    const next = sidebarSize(width);
    setSidebarWidth(next);
    localStorage.setItem("hearth-sidebar-width", String(next));
  };
  const resizeProfile = (width: number) => {
    const next = profileSize(
      width,
      window.innerWidth - (sidebarHidden ? 0 : sidebarWidth),
    );
    setProfileWidth(next);
    localStorage.setItem("hearth-profile-width", String(next));
  };
  useEffect(() => {
    const fitPanels = () =>
      setProfileWidth((width) =>
        profileSize(
          width,
          window.innerWidth - (sidebarHidden ? 0 : sidebarWidth),
        ),
      );
    fitPanels();
    window.addEventListener("resize", fitPanels);
    return () => window.removeEventListener("resize", fitPanels);
  }, [sidebarWidth, sidebarHidden]);
  const [data, setData] = useState<Snapshot>();
  const layoutQueue = useRef(Promise.resolve(true));
  const [page, setPage] = useState<Page>("Office");
  const [settingsOpenCount, setSettingsOpenCount] = useState(0);
  function openSettings() { setSettingsOpenCount(count => count + 1); setPage("Settings"); }
  useEffect(() => {
    setTasksOpen(false);
    setRailProjectsOpen(false);
  }, [page]);
  const [selected, setSelected] = useState<string>();
  const [selectedRun, setSelectedRun] = useState<string>();
  const [chat, setChat] = useState<CodexChat>();
  const [readCompletedChats, setReadCompletedChats] = useState<Set<string>>(() => getReadCompletedChats());
  const [readBoardPins, setReadBoardPins] = useState<Set<string>>(() => getReadBoardPins());
  useEffect(() => {
    if (page !== "Tasks" || !data) return;
    const ids = [
      ...data.runs.filter(item => item.status === "completed" && item.result && (item.teamId || "default") === (data.activeTeamId || "default")).map(item => item.chatThreadId || item.id),
      ...(data.runtime.completedChats || []).map(item => item.threadId),
    ];
    setReadBoardPins(markBoardPinsRead(ids));
  }, [page, data?.activeTeamId, data?.runs, data?.runtime.completedChats]);
  useEffect(() => {
    if (!chat?.id || !data) return;
    const isComplete = data.runs.some(item => item.status === "completed" && (item.chatThreadId === chat.id || item.assignments.some(assignment => assignment.threadId === chat.id))) || data.runtime.completedChats?.some(item => item.threadId === chat.id);
    if (isComplete && !readCompletedChats.has(chat.id)) setReadCompletedChats(markCompletedChatRead(chat.id));
  }, [chat?.id, data?.runs, data?.runtime.completedChats, readCompletedChats]);
  const [rightMode, setRightMode] = useState<"chat" | "member">("member");
  const [pendingNormal, setPendingNormal] = useState<string>();
  const [projectId, setProjectId] = useState(
    () => localStorage.getItem("hearth-project") || "",
  );
  const [projectSearch, setProjectSearch] = useState("");
  const [projectsOpen, setProjectsOpen] = useState(
    () => localStorage.getItem("hearth-projects-open") !== "false",
  );
  const [tab, setTab] = useState<"profile" | "work" | "journal">("profile");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [stream, setStream] = useState(false);
  const [draftChat, setDraftChat] = useState<number>();
  const draftSequence = useRef(0);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState(false);
  const [filterAgent, setFilterAgent] = useState(false);
  const [reduced, setReduced] = useState(
    () =>
      localStorage.getItem("hearth-reduced") === "true" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [preview, setPreview] = useState<Record<string, CharacterState>>({});
  useEffect(() => {
    let alive = true;
    api<Snapshot>("/state")
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => setError(e.message));
    const events = new EventSource("/api/events");
    events.onopen = () => setStream(true);
    events.onerror = () => setStream(false);
    events.onmessage = (e) => {
      if (alive) setData(JSON.parse(e.data));
    };
    return () => {
      alive = false;
      events.close();
    };
  }, []);
  const teamRuns = (data?.runs || []).filter(
    (run) => (run.teamId || "default") === (data?.activeTeamId || "default"),
  );
  const previousAccount = useRef<string | undefined>(undefined);
  useEffect(() => {
    const id = data?.accounts?.selected;
    if (previousAccount.current && previousAccount.current !== id) {
      setChat(undefined); setSelectedRun(undefined); setDraftChat(undefined);
      setPendingNormal(undefined); setError(""); setNotice("");
    }
    previousAccount.current = id;
  }, [data?.accounts?.selected]);
  const previousTeam = useRef<string | undefined>(undefined);
  useEffect(() => {
    const id = data?.activeTeamId;
    if (!id) return;
    if (previousTeam.current && previousTeam.current !== id) {
      setSelected(undefined);
      setChat(undefined);
      setSelectedRun(undefined);
      setDraftChat(undefined);
      setPreview({});
      setPage((current) => (current === "Settings" ? "Settings" : "Office"));
    }
    previousTeam.current = id;
  }, [data?.activeTeamId]);
  const projects = data?.runtime.projects || [];
  const selectedProject = projects.find((p) => p.id === projectId);
  const visibleRuns = teamRuns.filter(
    (r) =>
      !selectedProject ||
      r.demo ||
      projectContains(selectedProject, r.workspace),
  );
  const run =
    (page === "Tasks" && visibleRuns.find((r) => r.id === selectedRun)) ||
    (chat &&
      teamRuns.find(
        (r) =>
          r.chatThreadId === chat.id ||
          r.assignments.some((a) => a.threadId === chat.id),
      )) ||
    visibleRuns.find((r) => r.id === selectedRun) ||
    visibleRuns[0];
  function chooseProject(project?: CodexProject, keepPickerOpen = false) {
    setTasksOpen(false);
    if (!keepPickerOpen) setRailProjectsOpen(false);
    setProjectId(project?.id || "");
    localStorage.setItem("hearth-project", project?.id || "");
    if (project?.roots[0])
      localStorage.setItem("hearth-workspace", project.roots[0]);
    setSelectedRun(undefined);
    setDraftChat(undefined);
    setChat(undefined);
    setPage("Office");
  }
  const normal =
    data &&
    normalAgent(
      data.team.agents.find((a) => a.role === "lead" && a.enabled)!,
      [8, 9, 10, 11, 6, 7, 4, 5, 0, 1, 2, 3].find(
        (slot) => !data.team.agents.some((a) => a.workstation === slot),
      ) ?? 11,
      data.team.normalAppearance,
    );
  const officeAgents = data
    ? [
        ...data.team.agents.filter((a) => a.enabled),
        ...(normal && data.team.agents.length < 12 ? [normal] : []),
      ]
    : [];
  const agent = officeAgents.find((a) => a.id === selected);
  const latestChatRun = teamRuns.find(
    (r) =>
      !!chat?.id &&
      (r.options?.sourceThreadId === chat.id ||
        r.chatThreadId === chat.id ||
        r.assignments.some((a) => a.threadId === chat.id)),
  );
  const chatRun =
    latestChatRun &&
    ["queued", "running", "approval"].includes(latestChatRun.status)
      ? latestChatRun
      : undefined;
  useEffect(() => {
    if (latestChatRun?.options?.mode === "normal") setSelected("codex-normal");
  }, [chat?.id, latestChatRun?.id]);
  function newChat() {
    setTasksOpen(false);
    setRailProjectsOpen(false);
    setChat(undefined);
    setSelectedRun(undefined);
    setDraftChat(++draftSequence.current);
    setSelected(
      ["normal", "goal"].includes(savedComposer()?.mode || "")
        ? "codex-normal"
        : data?.team.agents.find((a) => a.role === "lead" && a.enabled)?.id ||
            "atlas",
    );
    setRightMode("chat");
    setProfileHidden(false);
    setError("");
    setPage("Chat");
  }
  useEffect(() => {
    if (!pendingNormal || !data) return;
    const pending = data.runs.find((r) => r.id === pendingNormal),
      assignment = pending?.assignments.find((a) => a.threadId);
    if (pending && assignment?.threadId) {
      setChat({
        id: assignment.threadId,
        name: pending.task.split("\n")[0].slice(0, 120),
        cwd: pending.workspace,
        projectId: pending.options?.projectId,
        updatedAt: Date.now() / 1000,
      });
      setRightMode("chat");
      setPage("Chat");
      setPendingNormal(undefined);
    }
  }, [pendingNormal, data]);
  async function action(fn: () => Promise<unknown>, message?: string) {
    setError("");
    setBusy(true);
    try {
      await fn();
      if (message) {
        setNotice(message);
        setTimeout(() => setNotice(""), 3500);
      }
      setData(await api<Snapshot>("/state"));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function save(team: Team) {
    return action(
      () => api(`/team?teamId=${data?.activeTeamId || "default"}`, "PUT", team),
      "Team saved",
    );
  }
  const preferenceQueue = useRef(Promise.resolve());
  function savePreference(key: string, value: unknown) {
    preferenceQueue.current = preferenceQueue.current
      .catch(() => {})
      .then(async () => {
        const response = await fetch("/api/preferences", {
          method: "PUT",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value }),
        });
        if (!response.ok) throw Error("Could not save preferences.");
        const preferences = await response.json();
        setData((current) => (current ? { ...current, preferences } : current));
      })
      .catch((error) => setError(String(error)));
  }
  function savedComposer(id?: string) {
    const saved = (
      data?.preferences?.composers[
        composerKey(id, projectId, data?.activeTeamId)
      ] ||
      (() => {
        const fallback = data?.preferences?.composers[
          composerKey(undefined, projectId, data?.activeTeamId)
        ];
        return id && fallback?.mode === "goal" ? { ...fallback, mode: "normal" as const } : fallback;
      })()
    );
    if (!id) return saved;
    const previousDeviceOptions = data?.runs
      .filter(run => run.chatThreadId === id || run.assignments.some(assignment => assignment.threadId === id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .find(run => run.options?.deviceSessionId)?.options;
    const chatSaved = data?.preferences?.composers[composerKey(id, projectId, data?.activeTeamId)];
    return previousDeviceOptions ? {
      ...(saved || { mode: "team" as const, permissions: "ask" as const, allowWrite: true, models: {} }),
      deviceTools: chatSaved?.deviceTools ?? previousDeviceOptions.deviceTools ?? [],
      deviceSessionId: previousDeviceOptions.deviceSessionId,
    } : saved;
  }
  async function createTask(values: unknown) {
    return action(async () => {
      const r = await api<Run & { followup?: boolean }>("/runs", "POST", values);
      if (r.followup) return;
      setSelectedRun(r.id);
      setRightMode("chat");
      setProfileHidden(false);
      setDraftChat(undefined);
      setPreview({});
      const destination = createdTaskDestination(r, chat?.id);
      if (destination.kind === "thread")
        setChat({
          id: destination.threadId,
          name: r.task.split("\n")[0].slice(0, 120),
          cwd: r.workspace,
          projectId: r.options?.projectId,
          updatedAt: Date.now() / 1000,
        });
      else if (destination.kind === "wait-for-thread") setPendingNormal(r.id);
      else setPendingNormal(undefined);
      setPage("Chat");
    });
  }
  function select(id: string) {
    setTasksOpen(false);
    setRailProjectsOpen(false);
    setRightMode("member");
    setSelected(id);
    setTab("profile");
  }
  async function addAccountLogin() {
    const popup = window.open("about:blank", "codex-sign-in");
    const ok = await action(async () => {
      const { authUrl } = await api<{ authUrl: string }>("/accounts", "POST", { provider: "codex" });
      if (popup) popup.location.href = authUrl;
      else { openSettings(); throw Error("Allow popups and click Add account again to finish signing in."); }
    });
    if (!ok) popup?.close();
  }
  async function confirmAccountLogout(): Promise<{ cancelled?: boolean; remoteRevocationConfirmed?: boolean }> {
    const accountId = data?.accounts?.selected;
    if (!accountId || accountId === "desktop") throw Error("Desktop Codex sign-in is managed in Codex.");
    const account = data?.accounts?.profiles.find(profile => profile.id === accountId)?.label || data?.runtime.account || "this account";
    const confirmed = await new Promise<boolean>(resolve => setLogoutPrompt({ account, resolve }));
    if (!confirmed) return { cancelled: true };
    return api<{ remoteRevocationConfirmed?: boolean; cancelled?: boolean }>("/runtime/logout", "POST", { accountId });
  }
  function openCharacterChat(id?: string) {
    const owner = teamRuns.find(r => ["running", "queued", "approval", "waiting"].includes(r.status) &&
      (id === "codex-normal" && r.options?.mode === "normal" || r.assignments.some(a => a.agentId === id &&
        (["running", "queued", "approval"].includes(a.status) || a.id === r.question?.assignmentId))));
    if (owner) { openRunChat(owner); return; }
    const external = id === "codex-normal" ? data?.runtime.activeChats?.[0] : undefined;
    if (external) {
      setChat({ id: external, name: "Codex chat", cwd: selectedProject?.roots[0] || "", updatedAt: Date.now() / 1000 });
      setDraftChat(undefined);
      setRightMode("chat"); setProfileHidden(false); return;
    }
    if (!draftChat && !chat && run) openRunChat(run);
    else setRightMode("chat");
  }
  function add() {
    if (!data) return;
    const used = data.team.agents.map((a) => a.workstation);
    const workstation = Array.from({ length: 12 }, (_, i) => i).find(
      (i) => !used.includes(i),
    );
    if (workstation === undefined) {
      setError("The office supports up to 12 members.");
      return;
    }
    const source =
      data.team.agents.find((a) => a.role === "researcher") ||
      data.team.agents[0];
    const member: Agent = {
      ...structuredClone(source),
      id: crypto.randomUUID(),
      name: "New explorer",
      role: "researcher",
      title: "Specialist",
      sprite: "pip",
      access: "read-only",
      workstation,
      expertise: ["Research"],
      instructions: "Investigate your assigned question and return evidence.",
      biography: "A new face at the workshop.",
    };
    void save({ ...data.team, agents: [...data.team.agents, member] }).then(
      () => setSelected(member.id),
    );
  }
  const activeRuns = teamRuns.filter((r) =>
    ["queued", "running", "approval"].includes(r.status),
  );
  const officeRun = activeRuns.length
    ? {
        ...(activeRuns.find((r) => r.id === run?.id) || activeRuns[0]),
        assignments: activeRuns.flatMap((r) =>
          r.assignments.map((a) =>
            r.options?.mode === "normal"
              ? { ...a, agentId: "codex-normal" }
              : a,
          ),
        ),
      }
    : run;
  const runIndicator = officeRunIndicator(officeRun);
  const currentStates = {
    ...derive(officeRun),
    ...(officeRun?.demo ? preview : {}),
  };
  // A completed assignment in another chat must not hide current work.
  for (const active of activeRuns) {
    for (const [id, state] of Object.entries(derive(active))) {
      const key = active.options?.mode === "normal" ? "codex-normal" : id;
      if (["working", "planning", "approval", "waiting"].includes(state))
        currentStates[key] = state;
    }
  }
  const events = (data?.events || []).filter(
    (e) => e.runId === run?.id && (!filterAgent || e.agentId === selected),
  );
  const progressByAgent: Record<string, string> = {};
  for (const active of activeRuns)
    for (const assignment of active.assignments) {
      const text = data?.runtime.chatProgress?.[assignment.threadId || active.chatThreadId || ""];
      if (text && ["running", "approval"].includes(assignment.status))
        progressByAgent[active.options?.mode === "normal" ? "codex-normal" : assignment.agentId] = text;
    }
  const externalWorkingChat = data?.runtime.activeChats?.find(id => !activeRuns.some(active =>
    active.chatThreadId === id || active.assignments.some(assignment => assignment.threadId === id)));
  if (externalWorkingChat)
    progressByAgent["codex-normal"] = data?.runtime.chatProgress?.[externalWorkingChat] || "Working in Codex…";
  if (data?.runtime.activeChats?.some(id => !activeRuns.some(active =>
    active.chatThreadId === id || active.assignments.some(assignment => assignment.threadId === id))))
    currentStates["codex-normal"] = "working";
  if (!data)
    return (
      <div className="boot">
        <span className="brand-symbol">P</span>
        <h1>Opening PixelCrew…</h1>
        <p>{error || "Connecting to your local studio."}</p>
        {error && <button onClick={() => location.reload()}>Try again</button>}
      </div>
    );
  const externalBoardTasks: Run[] = (data.runtime.completedChats || []).filter(item =>
    !data.runs.some(run => run.chatThreadId === item.threadId && run.status === "completed" && run.assignments.some(assignment => assignment.turnId === item.turnId))
  ).map(item => ({ external: true, id: `external:${item.threadId}:${item.turnId}`, teamId: data.activeTeamId, task: item.name, criteria: "", workspace: item.cwd,
    references: [], team: { ...data.team, agents: [normal!] }, demo: false, allowWrite: false, status: "completed", createdAt: item.startedAt, result: item.result, revision: 0, chatThreadId: item.threadId,
    options: { mode: "normal", models: {}, attachments: [], mentions: [] },
    assignments: [{ id: item.turnId, agentId: "codex-normal", stage: "build", objective: item.name, status: "completed", output: item.result, threadId: item.threadId, turnId: item.turnId, startedAt: item.startedAt, finishedAt: item.finishedAt }],
  }));
  const boardTasks = completedBoardTasks([...teamRuns, ...externalBoardTasks]);
  const completedChatIds = [...new Set([
    ...data.runs.filter(item => item.status === "completed").flatMap(item => [item.chatThreadId, ...item.assignments.map(assignment => assignment.threadId)]).filter((id): id is string => !!id),
    ...(data.runtime.completedChats || []).map(item => item.threadId),
  ])];
  const markChatRead = (id: string) => setReadCompletedChats(markCompletedChatRead(id));
  const markBoardRead = (ids: string[]) => setReadBoardPins(markBoardPinsRead(ids));
  const boardHasUnread = boardTasks.some(task => !readBoardPins.has(task.chatThreadId || task.id));
  const chatRuns = chat
    ? data.runs
        .filter(
          (r) =>
            r.chatThreadId === chat.id ||
            r.assignments.some((a) => a.threadId === chat.id),
        )
        .slice()
        .reverse()
    : run?.groupChat || run?.demo
      ? [run]
      : [];
  const taskItems = visibleRuns
    .filter((task) => !task.demo && task.options?.mode !== "normal")
    .filter(
      (task, index, all) =>
        !task.chatThreadId ||
        index ===
          all.findIndex((other) => other.chatThreadId === task.chatThreadId),
    );
  const openRunChat = (target: Run) => {
    setDraftChat(undefined);
    if (target.options?.projectId) {
      setProjectId(target.options.projectId);
      localStorage.setItem("hearth-project", target.options.projectId);
    }
    setSelectedRun(target.id);
    setRightMode("chat");
    setProfileHidden(false);
    const id =
      target.chatThreadId ||
      target.assignments.find((a) => a.threadId)?.threadId;
    if (id) markChatRead(id);
    markBoardRead([target.chatThreadId || target.id]);
    if (id)
      setChat({
        id,
        name: target.task.split("\n")[0],
        cwd: target.workspace,
        projectId: target.options?.projectId,
        updatedAt: Date.now() / 1000,
      });
    else setChat(undefined);
    setPage("Office");
  };
  const normalChat = chat ? (
    <ChatView
      chat={chat}
      speaker={normal || undefined}
      speakers={Object.fromEntries(
        chatRuns.flatMap((saved) =>
          saved.assignments.flatMap((assignment) => {
            const member = saved.team.agents.find(
              (member) => member.id === assignment.agentId,
            );
            return assignment.turnId && member
              ? [
                  [
                    assignment.turnId,
                    saved.options?.mode === "normal"
                      ? normal || normalAgent(member)
                      : member,
                  ],
                ]
              : [];
          }),
        ),
      )}
      questionUI={
        chatRun?.question && !chatRun.groupChat ? (
          <QuestionCard
            key={chatRun.question.assignmentId}
            sender={normal?.name || "Nova"}
            questions={[
              {
                id: "reply",
                question: chatRun.question.text.split(/\n\s*\n/)[0],
                options: questionChoices(chatRun.question.text),
              },
            ]}
            onSend={(answers) =>
              createTask({
                task: answers.reply,
                workspace: chatRun.workspace,
                allowWrite: chatRun.allowWrite,
                options: {
                  ...chatRun.options,
                  goalObjective: undefined,
                  goalTokenBudget: undefined,
                  sourceThreadId: chat.id,
                  delivery: "queue",
                },
              })
            }
          />
        ) : undefined
      }
      running={!!chatRun || !!data.runtime.activeChats?.includes(chat.id)}
      runError={
        latestChatRun?.status === "failed"
          ? latestChatRun.error || "The task failed. Open Tasks for details."
          : undefined
      }
      composer={
        <TaskModal
          followupBehavior={data.preferences?.followupBehavior}
          key={chat.id}
          accountNotice={chatRun && ["running", "queued", "approval"].includes(chatRun.status) ? `Running with ${data.accounts?.profiles.find(profile => profile.id === (chatRun.accountId || "desktop"))?.label || "its original account"}.${(chatRun.accountId || "desktop") !== data.accounts?.selected ? " Select that account to send follow-ups, or wait for this task to finish." : ""}` : undefined}
          queuedMessages={[
            ...(data.queuedMessages || []).filter(message => message.threadId === chat.id).map(message => ({ ...message, attachments: message.options.attachments, preview: message.options.attachments.some(a => a.kind === "image") ? `/api/queued/${message.id}/image` : undefined })),
            ...chatRuns.flatMap(run => (run.inbox || []).filter(message => message.status === "queued").map(message => ({ ...message, id: `run:${run.id}:${message.id}`, preview: message.attachments?.some(a => a.kind === "image") ? `/api/queued/run:${run.id}:${message.id}/image` : undefined }))),
          ]}
          onQueuedAction={(id, choice, text) => {
            if (id.startsWith("run:")) {
              const [, runId, messageId] = id.split(":");
              return action(() => api(`/runs/${runId}/inbox/${messageId}`, choice === "remove" ? "DELETE" : choice === "edit" ? "PUT" : "POST", choice === "edit" ? { text } : {}));
            } else return action(() => api(`/queued/${id}${choice === "steer" ? "/steer" : ""}`, choice === "remove" ? "DELETE" : choice === "edit" ? "PUT" : "POST", choice === "edit" ? { text } : {}));
          }}
          teamId={data.activeTeamId}
          preferences={savedComposer(chat.id)}
          deviceAccess={{ allowChrome: data.preferences?.allowChrome ?? false, allowWindowsComputer: data.preferences?.allowWindowsComputer ?? false, browserAvailable: data.deviceToolStatus?.browser.available ?? false, chromeAvailable: data.deviceToolStatus?.chrome.available ?? false, computerAvailable: data.deviceToolStatus?.computer.available ?? false }}
          onPreferencesChange={(value) => {
            savePreference(
              composerKey(chat.id, projectId, data?.activeTeamId),
              value,
            );
          }}
          inline
          groupChat={chatRuns.some(run => run.groupChat || run.options?.continueSourceThread)}
          onModeChange={(mode) =>
            setSelected(
              mode === "normal" || mode === "plan" || mode === "goal"
                ? "codex-normal"
                : data.team.agents.find((a) => a.role === "lead" && a.enabled)!
                    .id,
            )
          }
          allowFollowup={!!chatRun || !!data.runtime.activeChats?.includes(chat.id)}
          replyTo={
            chatRun?.question
              ? chatRun.team.agents.find(
                  (a) =>
                    a.id ===
                    chatRun.assignments.find(
                      (a) => a.id === chatRun.question?.assignmentId,
                    )?.agentId,
                )?.name
              : undefined
          }
          error={error}
          team={data.team}
          models={data.runtime.models}
          sourceChat={{ ...chat, cwd: chatRun?.workspace || chat.cwd }}
          projects={projects}
          selectedProject={selectedProject}
          busy={busy}
          connected={data.runtime.connected && data.runtime.authenticated}
          running={!!chatRun || !!data.runtime.activeChats?.includes(chat.id)}
          onInterrupt={() => {
            void action(() => api(chatRun ? `/runs/${chatRun.id}/interrupt` : `/chats/${chat.id}/interrupt`, "POST", {}));
          }}
          onClose={() => {}}
          onCreate={createTask}
        />
      }
      approvalUI={data.approvals
        .filter((a) => chatRun?.id === a.runId)
        .map((a) =>
          a.questions ? (
            <QuestionForm
              key={a.id}
              approval={a}
              sender={
                data.runs
                  .find((r) => r.id === a.runId)
                  ?.team.agents.find((member) => member.id === a.agentId)
                  ?.name || a.agentId
              }
              send={(answers) =>
                action(() =>
                  api(`/approvals/${a.id}`, "POST", {
                    accept: true,
                    answers,
                  }),
                )
              }
            />
          ) : (
            <div className="approval-box" key={a.id}>
              <h3>Approval requested</h3>
              <pre>{a.title}</pre>
              <details>
                <summary>Request details</summary>
                <pre>{a.detail}</pre>
              </details>
              <div className="button-row">
                <button
                  className="primary"
                  onClick={() =>
                    void action(() =>
                      api(`/approvals/${a.id}`, "POST", {
                        accept: true,
                      }),
                    )
                  }
                >
                  Approve once
                </button>
                <button
                  className="secondary"
                  onClick={() =>
                    void action(() =>
                      api(`/approvals/${a.id}`, "POST", {
                        accept: false,
                      }),
                    )
                  }
                >
                  Decline
                </button>
              </div>
            </div>
          ),
        )}
    />
  ) : undefined;
  const conversation = draftChat ? (
    <section className="group-chat draft-chat" aria-label="New chat">
      <header className="group-chat-heading">
        <div>
          <strong>New chat</strong>
          <small>{selectedProject?.name || "Local workspace"}</small>
        </div>
      </header>
      <div className="group-chat-log draft-chat-empty" />
      <TaskModal
          followupBehavior={data.preferences?.followupBehavior}
        key={`draft-${draftChat}`}
        teamId={data.activeTeamId}
        preferences={savedComposer()}
        deviceAccess={{ allowChrome: data.preferences?.allowChrome ?? false, allowWindowsComputer: data.preferences?.allowWindowsComputer ?? false, browserAvailable: data.deviceToolStatus?.browser.available ?? false, chromeAvailable: data.deviceToolStatus?.chrome.available ?? false, computerAvailable: data.deviceToolStatus?.computer.available ?? false }}
        onPreferencesChange={(value) =>
          savePreference(
            composerKey(undefined, projectId, data?.activeTeamId),
            value,
          )
        }
        inline
        focusOnMount
        groupChat
        error={error}
        team={data.team}
        models={data.runtime.models}
        projects={projects}
        selectedProject={selectedProject}
        busy={busy}
        connected={data.runtime.connected && data.runtime.authenticated}
        onClose={() => {}}
        onCreate={createTask}
        onModeChange={(mode) =>
          setSelected(
            mode === "normal" || mode === "plan" || mode === "goal"
              ? "codex-normal"
              : data.team.agents.find((a) => a.role === "lead" && a.enabled)!
                  .id,
          )
        }
      />
    </section>
  ) : chatRuns.length ? (
    <GroupChat
      sharedNormal={normal || undefined}
      runs={chatRuns}
      events={data.events}
      chat={chat}
      onDetails={() => setPage("Tasks")}
      onRetry={(target) => {
        void action(() => api(`/runs/${target.id}/resume`, "POST", {}));
      }}
      composer={normalChat?.props.composer}
      approvalUI={normalChat?.props.approvalUI}
      onAnswer={async (text) => {
        if (!chatRun || !chat) return false;
        return createTask({
          task: text,
          workspace: chatRun.workspace,
          allowWrite: chatRun.allowWrite,
          options: {
            ...chatRun.options,
            goalObjective: undefined,
            goalTokenBudget: undefined,
            sourceThreadId: chat.id,
            delivery: "queue",
          },
        });
      }}
    />
  ) : (
    normalChat
  );
  return (
    <div
      className={`app-shell ${page === "Office" || page === "Chat" ? "office-workspace" : ""} ${profileHidden || compactViewport && !chat && !draftChat && !selected ? "right-panel-hidden" : ""}`}
    >
      <aside
        className={`sidebar ${sidebarCompact ? "compact" : ""} ${railProjectsOpen ? "projects-open" : ""}`}
        style={{
          width: compactViewport ? 56 : sidebarWidth,
          display: sidebarHidden ? "none" : undefined,
        }}
      >
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTasksOpen(false);
            setRailProjectsOpen(false);
            setPage("Office");
          }}
        >
          <span className="brand-symbol">
            P<span />
          </span>
          <span>
            PixelCrew<small>CODEX TEAM STUDIO</small>
          </span>
        </a>
        <div className="workspace-label">
          YOUR WORKSPACE <span>{projects.length || "—"}</span>
        </div>
        <nav>
          {pages
            .filter((p) => p.name !== "Settings")
            .map(({ name, icon: Icon }) => (
              <div className="nav-group" key={name}>
                <button
                  key={name}
                  aria-label={name}
                  title={name}
                  className={
                    (
                      name === "Tasks"
                        ? tasksOpen || page === "Tasks"
                        : page === name &&
                          !tasksOpen &&
                          !railProjectsOpen &&
                          !projectsFocused
                    )
                      ? "active"
                      : ""
                  }
                  aria-pressed={
                    name === "Tasks"
                      ? tasksOpen || page === "Tasks"
                      : page === name &&
                        !tasksOpen &&
                        !railProjectsOpen &&
                        !projectsFocused
                  }
                  aria-expanded={name === "Tasks" ? tasksOpen : undefined}
                  onClick={() => {
                    if (name === "Tasks") {
                      setTasksOpen(!tasksOpen);
                      setRailProjectsOpen(false);
                    } else {
                      setTasksOpen(false);
                      setRailProjectsOpen(false);
                      setPage(name);
                    }
                  }}
                >
                  <Icon size={18} />
                  <span className="nav-label">{name}</span>
                  {name === "Office" && (
                    <span className="nav-count">{data.team.agents.length}</span>
                  )}
                  {name === "Tasks" && (
                    <ChevronDown
                      size={14}
                      className={`nav-chevron ${tasksOpen ? "" : "folded"}`}
                    />
                  )}
                </button>
                {name === "Tasks" && tasksOpen && (
                  <div
                    className={`sidebar-task-list ${sidebarCompact ? "rail-task-popover" : ""}`}
                    aria-label="Task history"
                  >
                    {sidebarCompact && (
                      <button
                        className="quiet rail-close"
                        aria-label="Close tasks"
                        onClick={() => setTasksOpen(false)}
                      >
                        <X size={16} />
                      </button>
                    )}
                    {taskItems.length ? (
                      taskItems.map((task) => (
                        <button
                          key={task.id}
                          className={
                            page === "Tasks" && run?.id === task.id
                              ? "selected"
                              : ""
                          }
                          title={task.task}
                          onClick={() => {
                            setSelectedRun(task.id);
                            setPage("Tasks");
                            if (sidebarCompact) setTasksOpen(false);
                          }}
                        >
                          <i className={`status-dot ${task.status}`} />
                          <span>{task.task}</span>
                        </button>
                      ))
                    ) : (
                      <small>No tasks yet</small>
                    )}
                  </div>
                )}
              </div>
            ))}
        </nav>
        <div className="sidebar-content">
          {sidebarCompact && (
            <button
              className="rail-projects"
              title="Projects"
              aria-label="Projects"
              aria-expanded={railProjectsOpen}
              onClick={() => {
                setRailProjectsOpen(!railProjectsOpen);
                setTasksOpen(false);
                setProjectsOpen(true);
              }}
            >
              <FolderOpen size={20} />
            </button>
          )}
          <section
            className="sidebar-projects"
            aria-label="Saved Codex projects"
          >
            {sidebarCompact && (
              <button
                className="quiet rail-close"
                aria-label="Close projects"
                onClick={() => setRailProjectsOpen(false)}
              >
                <X size={16} />
              </button>
            )}
            <div className="projects-heading">
              <button
                className={`projects-toggle ${projectsFocused ? "active" : ""}`}
                aria-pressed={projectsFocused}
                aria-expanded={projectsOpen}
                aria-controls="project-list"
                onClick={() => {
                  setProjectsOpen(!projectsOpen);
                  setProjectsFocused(!projectsOpen);
                  setTasksOpen(false);
                  localStorage.setItem(
                    "hearth-projects-open",
                    String(!projectsOpen),
                  );
                }}
              >
                <FolderOpen size={18} />
                <span className="projects-row-label">Projects</span>
                <span className="projects-count">{projects.length}</span>
                <ChevronDown
                  size={14}
                  className={projectsOpen ? "" : "folded"}
                />
              </button>
              {projectsOpen && (
                <button
                  disabled={busy}
                  title="Refresh saved Codex projects"
                  aria-label="Refresh Codex projects"
                  onClick={() =>
                    action(() => api("/projects/refresh", "POST", {}))
                  }
                >
                  <RotateCw size={14} />
                </button>
              )}
            </div>
            {projectsOpen && (
              <div id="project-list">
                <input
                  aria-label="Search Codex projects"
                  placeholder="Find a project…"
                  value={projectSearch}
                  onChange={(e) => setProjectSearch(e.target.value)}
                />
                <button
                  className={`project-link ${!selectedProject ? "selected" : ""}`}
                  aria-pressed={!selectedProject}
                  onClick={() => chooseProject()}
                >
                  <FolderOpen size={14} />
                  <span>All projects</span>
                </button>
                <ProjectTree
                  titleRevision={data.runtime.chatTitleRevision}
                  key={data.accounts?.selected || "desktop"}
                  pinnedProjects={data.preferences?.pinnedProjects}
                  onPinnedChange={(value) =>
                    savePreference("pinnedProjects", value)
                  }
                  runs={data.runs}
                  activeChats={data.runtime.activeChats}
                  completedChatIds={completedChatIds}
                  readCompletedChatIds={[...readCompletedChats]}
                  projects={projects.filter((p) =>
                    p.name.toLowerCase().includes(projectSearch.toLowerCase()),
                  )}
                  selected={projectId}
                  chatId={chat?.id}
                  onChat={(c, p) => {
                    markChatRead(c.id);
                    const matchingRun = teamRuns.find(
                      (item) =>
                        item.chatThreadId === c.id ||
                        item.assignments.some((assignment) => assignment.threadId === c.id),
                    );
                    const workspace = matchingRun?.workspace || c.cwd;
                    const chatProject =
                      projects.find((project) => project.id === c.projectId) ||
                      projects.find((project) =>
                        projectContains(project, workspace),
                      ) ||
                      (projectContains(p, workspace) ? p : undefined);
                    chooseProject(chatProject, true);
                    if (workspace) {
                      localStorage.setItem("hearth-workspace", workspace);
                    }
                    setChat({ ...c, cwd: workspace });
                    setRightMode("chat");
                    setProfileHidden(false);
                    setPage("Chat");
                  }}
                  onNew={(p) => {
                    chooseProject(p);
                    newChat();
                  }}
                />
                {!projects.length && (
                  <p className="project-help">
                    {data.runtime.connected
                      ? "No saved projects found."
                      : "Connect Codex to load your projects."}
                  </p>
                )}
                {data.runtime.projectsError && (
                  <p className="project-help error-text">
                    {data.runtime.projectsError}
                  </p>
                )}
              </div>
            )}
          </section>
          <div className="sidebar-team">
            <span className="eyebrow">THE CREW</span>
            {officeAgents.map((a) => (
              <button
                key={a.id}
                title={`${a.name} · ${a.title}`}
                aria-label={`${a.name}, ${a.title}`}
                onClick={() => {
                  select(a.id);
                  setPage("Office");
                }}
                className={a.id === selected ? "picked" : ""}
              >
                <Portrait agent={a} size={30} />
                <span>
                  {a.name}
                  <small>{a.title}</small>
                </span>
                <i className={`status-dot ${currentStates[a.id] || "idle"}`} />
              </button>
            ))}
            <button
              className="add-crew"
              onClick={add}
              disabled={busy || data.team.agents.length >= 11}
            >
              <Plus size={14} />
              Invite a specialist
            </button>
          </div>
        </div>
        <div className="sidebar-bottom">
          <AccountUsage runtime={data.runtime} compact={sidebarCompact} onOpenResets={() => setUsageResetsOpen(true)} />
          <details ref={accountMenu} className="sidebar-account" onToggle={event => {
            if (event.target !== event.currentTarget) return;
            const switcher = event.currentTarget.querySelector<HTMLDetailsElement>(".account-switcher");
            if (switcher) switcher.open = false;
          }}>
            <summary title={data.runtime.account || "Account"}><span className="account-avatar">{(data.runtime.account || "P").slice(0, 1).toUpperCase()}</span><span>{data.accounts?.disconnected ? "Logged out" : data.runtime.account || "Log in"}</span></summary>
            <div className="sidebar-account-menu">
              <div className="account-menu-identity">{data.runtime.account || "PixelCrew account"}</div>
              <details className="account-switcher">
                <summary><Users size={15} /><span>Switch account</span><ChevronRight size={13} /></summary>
                <div>{(data.accounts?.profiles || []).map(profile => <button key={profile.id} disabled={busy} aria-pressed={profile.id === data.accounts?.selected} onClick={() => void action(() => api("/accounts/select", "POST", { id: profile.id }))}><span className="account-option-avatar" aria-hidden="true">{profile.label.slice(0, 1).toUpperCase()}</span><span className="account-option-label">{profile.label}</span>{profile.id === data.accounts?.selected && <Check size={13} />}</button>)}</div>
              </details>
              <button disabled={busy} onClick={() => void addAccountLogin()}><Plus size={15} />Add account</button>
              <button onClick={() => openSettings()}><Settings size={15} />Settings</button>
              {data.accounts?.selected !== "desktop" && <button disabled={busy} onClick={() => void action(async () => {
                const result = await confirmAccountLogout();
                if (result.remoteRevocationConfirmed === false) setNotice("Account removed. Remote session revocation could not be confirmed; disconnect PixelCrew in ChatGPT Settings if needed.");
              })}><LogOut size={15} />Log out</button>}
            </div>
          </details>

        </div>
        <div
          className="sidebar-resizer"
          role="separator"
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          aria-valuemin={SIDEBAR_RAIL_WIDTH}
          aria-valuemax={420}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          onPointerDown={(event) => {
            sidebarDrag.current = { x: event.clientX, width: sidebarWidth };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (sidebarDrag.current)
              resizeSidebar(
                sidebarDrag.current.width +
                  event.clientX -
                  sidebarDrag.current.x,
              );
          }}
          onPointerUp={() => {
            sidebarDrag.current = undefined;
          }}
          onPointerCancel={() => {
            sidebarDrag.current = undefined;
          }}
          onDoubleClick={() => resizeSidebar(260)}
          onKeyDown={(event) => {
            if (
              ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
            ) {
              event.preventDefault();
              resizeSidebar(
                event.key === "Home"
                  ? SIDEBAR_RAIL_WIDTH
                  : event.key === "End"
                    ? 420
                    : sidebarCompact && event.key === "ArrowRight"
                      ? 200
                      : sidebarWidth + (event.key === "ArrowRight" ? 16 : -16),
              );
            }
          }}
        />
      </aside>
      {usageResetsOpen && <UsageResetDialog runtime={data.runtime} accountId={data.accounts?.selected || "desktop"} onClose={() => setUsageResetsOpen(false)} />}
      {logoutPrompt && <LogoutDialog account={logoutPrompt.account}
        onCancel={() => { logoutPrompt.resolve(false); setLogoutPrompt(undefined); }}
        onConfirm={() => { logoutPrompt.resolve(true); setLogoutPrompt(undefined); }} />}
      {sidebarHidden && <AccountUsage runtime={data.runtime} floating onOpenResets={() => setUsageResetsOpen(true)} />}
      <main className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            Projects <ChevronRight size={13} />
            <span title={selectedProject?.roots.join("\n")}>
              {selectedProject?.name || "All projects"}
            </span>
          </div>
          <div className="top-actions">
            <div className="layout-toggles" aria-label="Panel visibility">
              <button
                className="quiet sidebar-toggle"
                aria-label={
                  sidebarCompact ? "Expand sidebar" : "Collapse sidebar"
                }
                title={sidebarCompact ? "Expand sidebar" : "Collapse sidebar"}
                onClick={() => {
                  setSidebarHidden(false);
                  localStorage.setItem("hearth-sidebar-hidden", "false");
                  resizeSidebar(
                    sidebarCompact
                      ? Number(
                          localStorage.getItem("hearth-sidebar-expanded-width"),
                        ) || 260
                      : SIDEBAR_RAIL_WIDTH,
                  );
                  if (!sidebarCompact)
                    localStorage.setItem(
                      "hearth-sidebar-expanded-width",
                      String(sidebarWidth),
                    );
                  setTasksOpen(false);
                  setRailProjectsOpen(false);
                }}
              >
                {sidebarHidden ? (
                  <PanelLeftOpen size={19} />
                ) : (
                  <PanelLeftClose size={19} />
                )}
              </button>

              <button
                className="quiet"
                aria-label={
                  activityVisible
                    ? "Hide Activity panel"
                    : "Show Activity panel"
                }
                title={
                  activityVisible
                    ? "Hide Activity panel"
                    : "Show Activity panel"
                }
                aria-pressed={activityVisible}
                onClick={() => {
                  setActivityVisible(!activityVisible);
                  setActivity(true);
                  localStorage.setItem(
                    "hearth-activity-visible",
                    String(!activityVisible),
                  );
                }}
              >
                <PanelBottom size={18} />
              </button>
              <button
                className="quiet"
                aria-label={
                  profileHidden
                    ? "Show character details"
                    : "Hide character details"
                }
                title={
                  profileHidden
                    ? "Show character details"
                    : "Hide character details"
                }
                aria-pressed={!profileHidden}
                onClick={() => {
                  setProfileHidden(!profileHidden);
                  localStorage.setItem(
                    "hearth-profile-hidden",
                    String(!profileHidden),
                  );
                }}
              >
                {profileHidden ? (
                  <PanelRightOpen size={18} />
                ) : (
                  <PanelRightClose size={18} />
                )}
              </button>
            </div>

            <button
              className={`connection ${data.runtime.connected ? "online" : ""}`}
              title={data.runtime.error || "Manage Codex connection"}
              onClick={() => openSettings()}
              aria-label="Manage Codex connection"
            >
              <i />
              {data.runtime.connected
                ? data.runtime.authenticated
                  ? "Codex connected"
                  : "Sign-in needed"
                : "Codex offline"}
            </button>
            <button className="primary small" onClick={() => newChat()}>
              <Plus size={15} />
              New task
            </button>
          </div>
        </header>
        {error && (
          <div role="alert" className="banner error">
            <AlertCircle size={17} />
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div role="status" className="banner success">
            <CheckCircle2 size={16} />
            {notice}
          </div>
        )}
        <div
          className={`page-content ${page === "Office" || page === "Chat" ? "office-page" : ""}`}
          style={
            { "--profile-width": `${profileWidth}px` } as React.CSSProperties
          }
        >
          {page === "Office" || page === "Chat" ? (
            <>
              <section
                className="office-main"
                aria-label="Office workspace"
                tabIndex={0}
              >
                <div className="page-heading">
                  <div>
                    <h1>Office</h1>
                  </div>
                </div>
                <div className="room-toolbar">
                  <div className="room-title">
                    <span className="gold-dot" />
                    <TeamPicker
                      teams={
                        data.teams || [{ id: "default", name: data.team.name }]
                      }
                      value={data.activeTeamId || "default"}
                      busy={busy}
                      onChange={(id) =>
                        void action(() =>
                          api(`/teams/${id}/activate`, "POST", {}),
                        )
                      }
                    />
                    <span className="member-count">
                      {officeAgents.filter((a) => a.enabled).length} members
                    </span>
                  </div>
                  <span className="scene-mode">
                    {runIndicator === "simulated" ? (
                      <>
                        <Sparkles size={12} />
                        SIMULATED TOUR
                      </>
                    ) : runIndicator === "live" ? (
                      <>
                        <Radio size={12} />
                        {activeRuns.length > 1
                          ? `${activeRuns.length} LIVE TASKS`
                          : "LIVE TASK"}
                      </>
                    ) : null}
                  </span>
                </div>
                <Office
                  key={data.activeTeamId || "default"}
                  design={data.officeDesign}
                  completedRuns={boardTasks}
                  unreadBoard={boardHasUnread}
                  onOpenTask={openRunChat}
                  onViewChat={() => {
                    openCharacterChat(selected);
                  }}
                  layout={data.layout || {}}
                  onLayoutChange={(layout) => {
                    const saving = layoutQueue.current.then(() =>
                      action(() =>
                        api(
                          `/layout?teamId=${data.activeTeamId || "default"}`,
                          "PUT",
                          layout,
                        ),
                      ),
                    );
                    layoutQueue.current = saving;
                    return saving;
                  }}
                  agents={officeAgents}
                  states={currentStates}
                  progressByAgent={progressByAgent}
                  selected={selected}
                  onSelect={select}
                  onBoard={() => {
                    markBoardRead(boardTasks.map(task => task.chatThreadId || task.id));
                    setPage("Tasks");
                  }}
                  onApproval={(id) => {
                    const owner = activeRuns.find((r) =>
                      r.assignments.some(
                        (a) =>
                          a.agentId === id &&
                          (a.status === "approval" ||
                            a.id === r.question?.assignmentId),
                      ),
                    );
                    if (owner) openRunChat(owner);
                    else {
                      select(id);
                      setTab("work");
                    }
                  }}
                  reduced={reduced}
                  run={officeRun}
                  events={data.events.filter((e) =>
                    activeRuns.length
                      ? activeRuns.some((r) => r.id === e.runId)
                      : e.runId === officeRun?.id,
                  )}
                />
              </section>
              {!profileHidden && (
                <div
                  className="profile-resizer"
                  role="separator"
                  aria-label="Resize character details"
                  aria-orientation="vertical"
                  aria-valuemin={Math.min(
                    MIN_INSPECTOR_WIDTH,
                    profileSize(
                      Number.MAX_SAFE_INTEGER,
                      window.innerWidth - sidebarWidth,
                    ),
                  )}
                  aria-valuemax={profileSize(
                    Number.MAX_SAFE_INTEGER,
                    window.innerWidth - (sidebarHidden ? 0 : sidebarWidth),
                  )}
                  aria-valuenow={profileWidth}
                  tabIndex={0}
                  onPointerDown={(event) => {
                    profileDrag.current = {
                      x: event.clientX,
                      width: profileWidth,
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    if (profileDrag.current)
                      resizeProfile(
                        profileDrag.current.width +
                          profileDrag.current.x -
                          event.clientX,
                      );
                  }}
                  onPointerUp={() => {
                    profileDrag.current = undefined;
                  }}
                  onPointerCancel={() => {
                    profileDrag.current = undefined;
                  }}
                  onDoubleClick={() => resizeProfile(MIN_INSPECTOR_WIDTH)}
                  onKeyDown={(event) => {
                    if (
                      ["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                        event.key,
                      )
                    ) {
                      event.preventDefault();
                      resizeProfile(
                        event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? Number.MAX_SAFE_INTEGER
                            : profileWidth +
                              (event.key === "ArrowLeft" ? 16 : -16),
                      );
                    }
                  }}
                />
              )}
              <div
                className={`inspector-pane ${rightMode === "chat" ? "conversation-pane" : ""}`}
              >
                <div className="inspector-tabs">
                  <button
                    className={rightMode === "chat" ? "active" : ""}
                    onClick={() => {
                      openCharacterChat(selected);
                    }}
                  >
                    Chat
                  </button>
                  <button
                    className={rightMode === "member" ? "active" : ""}
                    onClick={() => {
                      if (latestChatRun?.options?.mode === "normal")
                        setSelected("codex-normal");
                      setRightMode("member");
                    }}
                  >
                    Member
                  </button>
                </div>
                <div
                  className="inspector-conversation"
                  hidden={rightMode !== "chat"}
                >
                  {conversation || (
                    <div className="inspector-empty">
                      <p>Start a task or open a project chat.</p>
                      <button className="primary" onClick={() => newChat()}>
                        New task
                      </button>
                    </div>
                  )}
                </div>
                {rightMode === "member" && !agent && (
                  <div className="inspector-empty" role="status">
                    <h3>Select a crew member</h3>
                    <p>
                      Choose a character in the office or sidebar to view and
                      edit their profile.
                    </p>
                  </div>
                )}
                {rightMode === "member" && agent && (
                  <Profile
                    key={`${data.activeTeamId}:${agent.id}`}
                    catalog={data.catalog}
                    agent={agent}
                    readOnly={agent.id === "codex-normal"}
                    team={data.team}
                    run={
                      agent.id === "codex-normal"
                        ? latestChatRun?.options?.mode === "normal"
                          ? latestChatRun
                          : teamRuns.find((r) => r.options?.mode === "normal")
                        : run
                    }
                    state={currentStates[agent.id] || "idle"}
                    models={data.runtime.models}
                    tab={tab}
                    setTab={setTab}
                    onSave={save}
                    onDelete={() =>
                      save({
                        ...data.team,
                        agents: data.team.agents.filter(
                          (a) => a.id !== agent.id,
                        ),
                      })
                    }
                    onDuplicate={() => {
                      const slot = Array.from({ length: 12 }, (_, i) => i).find(
                        (i) =>
                          !data.team.agents.some((a) => a.workstation === i),
                      );
                      if (slot === undefined) return;
                      void save({
                        ...data.team,
                        agents: [
                          ...data.team.agents,
                          {
                            ...structuredClone(agent),
                            id: crypto.randomUUID(),
                            name: agent.name + " II",
                            role:
                              agent.role === "lead" ? "researcher" : agent.role,
                            title:
                              agent.role === "lead"
                                ? "Specialist"
                                : agent.title,
                            workstation: slot,
                          },
                        ],
                      });
                    }}
                    busy={busy}
                    approvals={data.approvals.filter(
                      (a) => a.runId === run?.id && a.agentId === agent.id,
                    )}
                    onApproval={(id, accept, answers) =>
                      action(() =>
                        api("/approvals/" + id, "POST", {
                          accept,
                          answers,
                        }),
                      )
                    }
                    events={events.filter((e) => e.agentId === agent.id)}
                    preview={(s) =>
                      setPreview((p) => ({ ...p, [agent.id]: s }))
                    }
                  />
                )}
              </div>
            </>
          ) : page === "Tasks" ? (
            <section className="wide-page">
              <div className="page-heading">
                <div>
                  <h1>{page}</h1>
                </div>
              </div>
              <div className="task-layout task-single">
                {run ? (
                  <div className="task-detail">
                    {data.approvals
                      .filter((a) => a.runId === run.id && a.questions)
                      .map((a) => (
                        <QuestionForm
                          key={a.id}
                          approval={a}
                          sender={
                            data.runs
                              .find((r) => r.id === a.runId)
                              ?.team.agents.find(
                                (member) => member.id === a.agentId,
                              )?.name || a.agentId
                          }
                          send={(answers) =>
                            action(() =>
                              api("/approvals/" + a.id, "POST", {
                                accept: true,
                                answers,
                              }),
                            )
                          }
                        />
                      ))}
                    <div className="task-detail-head">
                      <Badge status={run.status} />
                      {run.demo && <span className="demo-tag">SIMULATED</span>}
                      <div className="run-actions">
                        <button
                          className="secondary"
                          onClick={() => openRunChat(run)}
                        >
                          <MessageCircle size={16} /> Open chat
                        </button>
                        {run.chatThreadId && !run.demo && (
                          <a
                            className="secondary"
                            href={`codex://threads/${run.chatThreadId}`}
                            title="Open the same parent chat in Codex"
                          >
                            Open in Codex ↗
                          </a>
                        )}
                        {["running", "approval", "queued"].includes(
                          run.status,
                        ) ? (
                          <>
                            <button
                              title="Interrupt"
                              onClick={() =>
                                action(() =>
                                  api(`/runs/${run.id}/interrupt`, "POST", {}),
                                )
                              }
                            >
                              <Pause size={16} />
                              Interrupt
                            </button>
                            <button
                              title="Cancel"
                              onClick={() =>
                                action(() =>
                                  api(`/runs/${run.id}/cancel`, "POST", {}),
                                )
                              }
                            >
                              <Square size={14} />
                              Cancel
                            </button>
                          </>
                        ) : (
                          !run.demo &&
                          ["failed", "interrupted"].includes(run.status) && (
                            <button
                              onClick={() =>
                                action(() =>
                                  api(`/runs/${run.id}/resume`, "POST", {}),
                                )
                              }
                            >
                              <RotateCw size={15} />
                              Reconcile & resume
                            </button>
                          )
                        )}
                      </div>
                    </div>
                    <h2>
                      {run.task.split("\n")[0].slice(0, 100)}
                      {run.task.length > 100 ? "…" : ""}
                    </h2>
                    <details className="request-detail">
                      <summary>Full request</summary>
                      <pre>{run.task}</pre>
                    </details>
                    <p className="path">
                      <FolderOpen size={14} />
                      {run.workspace}
                    </p>
                    {run.criteria && (
                      <div className="criteria">
                        <span className="eyebrow">DONE WHEN</span>
                        <p>{run.criteria}</p>
                      </div>
                    )}
                    {run.error && <p className="error-text">{run.error}</p>}
                    {run.assignments.map((a) => {
                      const profileOwner = run.team.agents.find(
                        (m) => m.id === a.agentId,
                      )!;
                      const owner =
                        run.options?.mode === "normal"
                          ? {
                              ...profileOwner,
                              name: "Codex",
                              title: "Assistant",
                            }
                          : profileOwner;
                      return (
                        <details
                          className="assignment"
                          key={a.id}
                          open={a.status === "approval"}
                        >
                          <summary>
                            <Portrait agent={owner} size={32} />
                            <span>
                              <strong>{owner.name}</strong>
                              <small>
                                {a.stage} · {a.objective.slice(0, 90)}
                              </small>
                            </span>
                            <Badge status={a.status} />
                          </summary>
                          <p>{a.objective}</p>
                          {a.threadId && (
                            <small className="path">
                              Codex thread: {a.threadId}
                            </small>
                          )}
                          <pre>
                            {a.error || a.output || "Work is in progress."}
                          </pre>
                          <p className="assignment-model">
                            {a.model ||
                              run.team.agents.find(
                                (agent) => agent.id === a.agentId,
                              )?.model ||
                              "Codex default"}
                            {a.reasoning ? ` · ${a.reasoning}` : ""}
                          </p>
                          <div className="assignment-metrics">
                            <span>{durationLabel(a.metrics?.durationMs)}</span>
                            <Usage usage={a.metrics?.usage} />
                          </div>
                          {a.threadId && (
                            <a
                              className="secondary"
                              href={`codex://threads/${encodeURIComponent(a.threadId)}`}
                            >
                              Open in Codex <ArrowUpRight size={14} />
                            </a>
                          )}
                          {!run.demo &&
                            ["failed", "interrupted"].includes(a.status) && (
                              <button
                                className="secondary"
                                disabled={busy}
                                onClick={() =>
                                  action(() =>
                                    api(`/runs/${run.id}/retry`, "POST", {
                                      assignmentId: a.id,
                                    }),
                                  )
                                }
                              >
                                <RotateCw size={13} />
                                Retry & continue
                              </button>
                            )}
                        </details>
                      );
                    })}
                    {data.approvals
                      .filter((a) => a.runId === run.id && !a.questions)
                      .map((a) => (
                        <div className="approval-box" key={a.id}>
                          <h3>Approval requested</h3>
                          <pre>{a.title}</pre>
                          <details>
                            <summary>Request details</summary>
                            <pre>{a.detail}</pre>
                          </details>
                          <div>
                            <button
                              className="primary"
                              onClick={() =>
                                action(() =>
                                  api("/approvals/" + a.id, "POST", {
                                    accept: true,
                                  }),
                                )
                              }
                            >
                              Approve once
                            </button>
                            <button
                              className="secondary"
                              onClick={() =>
                                action(() =>
                                  api("/approvals/" + a.id, "POST", {
                                    accept: false,
                                  }),
                                )
                              }
                            >
                              Decline
                            </button>
                          </div>
                        </div>
                      ))}
                    {run.result && (
                      <div className="result">
                        <span className="eyebrow">THE TEAM’S RESULT</span>
                        <Markdown
                          text={run.result}
                          chatId={
                            run.chatThreadId ||
                            run.assignments.find((a) => a.threadId)?.threadId
                          }
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="empty">
                    <Sparkles size={30} />
                    <h2>What shall we work on?</h2>
                    <p>Choose a workspace and give your team a task.</p>
                    <button className="primary" onClick={() => newChat()}>
                      Create a task
                    </button>
                  </div>
                )}
              </div>
            </section>
          ) : (
            <SettingsPage
              key={settingsOpenCount}
              onOpenResets={() => setUsageResetsOpen(true)}
              manage={(path, body) =>
                action(() =>
                  api(
                    `${path}?teamId=${data.activeTeamId || "default"}`,
                    path === "/preferences" ? "PUT" : "POST",
                    body,
                  ),
                )
              }
              data={data}
              busy={busy}
              reduced={reduced}
              onReducedChange={(value) => {
                setReduced(value);
                localStorage.setItem("hearth-reduced", String(value));
              }}
              save={save}
              signIn={(provider) =>
                api<{ authUrl: string }>("/runtime/login", "POST", { provider })
              }
              signOut={confirmAccountLogout}
              reconnect={() =>
                action(
                  () => api("/runtime/connect", "POST", {}),
                  "Runtime checked",
                )
              }
              onImport={(file) =>
                action(async () => {
                  const team = JSON.parse(await file.text());
                  await api(
                    `/team?teamId=${data?.activeTeamId || "default"}`,
                    "PUT",
                    team,
                  );
                }, "Team imported")
              }
            />
          )}
        </div>
        {(page === "Office" || page === "Chat") && activityVisible && (
          <div className="workspace-activity">
            {" "}
            <Activity
              expanded={activity}
              setExpanded={setActivity}
              events={events}
              team={run?.team || data.team}
              connected={stream}
              filter={filterAgent}
              onFilter={() => setFilterAgent(!filterAgent)}
              run={run}
            />
          </div>
        )}
      </main>
    </div>
  );
}

function Profile({
  catalog,
  agent,
  readOnly = false,
  team,
  run,
  state,
  models,
  tab,
  setTab,
  onSave,
  onDelete,
  onDuplicate,
  busy,
  approvals,
  onApproval,
  events,
  preview,
}: {
  agent: Agent;
  catalog?: Snapshot["catalog"];
  readOnly?: boolean;
  team: Team;
  run?: Run;
  state: CharacterState;
  models: Snapshot["runtime"]["models"];
  tab: "profile" | "work" | "journal";
  setTab: (t: "profile" | "work" | "journal") => void;
  onSave: (t: Team) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
  onDuplicate: () => void;
  busy: boolean;
  approvals: Snapshot["approvals"];
  onApproval: (
    id: string,
    accept: boolean,
    answers?: Record<string, string>,
  ) => Promise<unknown>;
  events: Snapshot["events"];
  preview: (s: CharacterState) => void;
}) {
  const [draft, setDraft] = useState<Agent>(structuredClone(agent));
  const [editing, setEditing] = useState(false);
  const editor = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!editing) return;
    editor.current?.querySelector<HTMLInputElement>("input")?.focus();
    editor.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [editing]);
  useEffect(() => {
    if (!editing) setDraft(structuredClone(agent));
  }, [agent, editing]);
  const change = <K extends keyof Agent>(key: K, value: Agent[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const assignments =
    run?.assignments.filter((a) => a.agentId === agent.id) || [];
  return (
    <aside
      className="profile-panel"
      aria-label="Character details"
      tabIndex={0}
      style={{ "--agent": agent.color } as React.CSSProperties}
    >
      <div className="profile-heading">
        <span className="eyebrow">Agent</span>
        <span className="profile-number">0{agent.workstation + 1}</span>
      </div>
      <div className="portrait-stage">
        <span className="portrait-stars">✦</span>
        <Portrait agent={draft} size={128} />
        <span className="portrait-spark">✧</span>
        <span className="portrait-platform" />
      </div>
      <div className="profile-identity">
        <span className="species">{descriptions[agent.sprite]}</span>
        <h2>{agent.name}</h2>
        <p>{agent.title}</p>
        <Badge status={state} />
      </div>
      <div className="profile-tabs">
        {(["profile", "work", "journal"] as const).map((t) => (
          <button
            className={tab === t ? "active" : ""}
            key={t}
            onClick={() => setTab(t)}
          >
            {t === "profile" ? "About" : t === "work" ? "Work" : "Journal"}
          </button>
        ))}
      </div>
      <div className="profile-body">
        {approvals
          .filter((a) => a.questions)
          .map((a) => (
            <QuestionForm
              key={a.id}
              approval={a}
              sender={agent.name}
              send={(answers) => onApproval(a.id, true, answers)}
            />
          ))}
        {tab === "profile" ? (
          <>
            {editing ? (
              <MemberEditor
                agent={agent}
                team={team}
                catalog={catalog}
                models={models}
                busy={busy}
                onCancel={() => setEditing(false)}
                onSave={async (next) => {
                  const saved = await onSave(next);
                  if (saved) setEditing(false);
                  return saved;
                }}
              />
            ) : (
              <>
                <p className="bio">{agent.biography}</p>
                <div className="profile-section">
                  <span className="eyebrow">
                    <Sparkles size={12} /> EXPERTISE
                  </span>
                  <div className="tags">
                    {agent.expertise.map((t) => (
                      <span key={t}>{t}</span>
                    ))}
                  </div>
                </div>
                <div className="profile-section">
                  <span className="eyebrow">
                    <BookOpen size={12} /> PERSONALITY
                  </span>
                  <p>{agent.personality}</p>
                </div>
                <div className="profile-section">
                  <span className="eyebrow">
                    <ShieldCheck size={12} /> INSTRUCTIONS
                  </span>
                  <p>{agent.instructions}</p>
                </div>
                <div className="profile-meta">
                  <span>
                    Model{" "}
                    <strong>
                      {readOnly
                        ? "Per chat"
                        : resolveProfile(
                            { ...agent, reasoning: undefined },
                            models,
                          ).model || "Codex default"}
                    </strong>
                  </span>
                  <span>
                    Reasoning{" "}
                    <strong>
                      {readOnly ? "Per chat" : agent.reasoning || "Auto"}
                    </strong>
                  </span>
                  <span>
                    Workspace{" "}
                    <strong>
                      {readOnly
                        ? "Per chat"
                        : agent.access === "read-only"
                          ? "Read only"
                          : "Can edit"}
                    </strong>
                  </span>
                </div>
                {(agent.id === "codex-normal" || !readOnly) && (
                  <button
                    className="secondary full"
                    type="button"
                    aria-expanded={editing}
                    onClick={() => setEditing(true)}
                  >
                    Edit character & profile
                    <ArrowUpRight size={14} />
                  </button>
                )}
                {!readOnly && (
                  <div className="profile-actions">
                    <button
                      className="quiet"
                      disabled={team.agents.length >= 11}
                      onClick={onDuplicate}
                    >
                      <Copy size={12} />
                      Duplicate
                    </button>
                    {agent.role !== "lead" && (
                      <button className="quiet" onClick={() => void onDelete()}>
                        <Trash2 size={12} />
                        Remove
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        ) : tab === "work" ? (
          <>
            {approvals
              .filter((a) => !a.questions)
              .map((a) => (
                <div className="approval-box" key={a.id}>
                  <h3>Your decision is needed</h3>
                  <pre>{a.title}</pre>
                  <details>
                    <summary>Action details</summary>
                    <pre>{a.detail}</pre>
                  </details>
                  <div className="button-row">
                    <button
                      disabled={busy}
                      className="primary"
                      onClick={() => onApproval(a.id, true)}
                    >
                      Approve once
                    </button>
                    <button
                      disabled={busy}
                      className="secondary"
                      onClick={() => onApproval(a.id, false)}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            {assignments.length ? (
              assignments.map((a) => (
                <div className="profile-section" key={a.id}>
                  <Badge status={a.status} />
                  <h3>{a.stage}</h3>
                  <p>{a.objective}</p>
                  <pre className="agent-output">
                    {a.output || a.error || "Awaiting a result."}
                  </pre>
                  <div className="assignment-metrics">
                    <span>{durationLabel(a.metrics?.durationMs)}</span>
                    <Usage usage={a.metrics?.usage} />
                  </div>
                </div>
              ))
            ) : (
              <div className="empty compact">
                <Armchair size={24} />
                <p>Ready when you are.</p>
                <small>Start a task to give {agent.name} an assignment.</small>
              </div>
            )}
          </>
        ) : (
          <div className="journal">
            {events.length ? (
              events.map((e) => (
                <div key={e.seq}>
                  <small>
                    {new Date(e.at).toLocaleTimeString()} · {e.kind}
                  </small>
                  <pre>{e.text}</pre>
                </div>
              ))
            ) : (
              <p className="muted">
                The journal will fill as this character works.
              </p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function QuestionForm({
  approval,
  send,
  sender,
}: {
  approval: Approval;
  sender: string;
  send: (answers: Record<string, string>) => Promise<unknown>;
}) {
  return (
    <QuestionCard
      questions={approval.questions || []}
      sender={sender}
      onSend={send}
    />
  );
}
function Activity({
  expanded,
  setExpanded,
  events,
  team,
  connected,
  filter,
  onFilter,
  run,
}: {
  expanded: boolean;
  setExpanded: (x: boolean) => void;
  events: Snapshot["events"];
  team: Team;
  connected: boolean;
  filter: boolean;
  onFilter: () => void;
  run?: Run;
}) {
  return (
    <section className="activity">
      <div className="activity-heading">
        <button onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          <Radio size={15} />
          <strong>Activity</strong>
          <span className="muted">{run?.demo ? "Simulated" : ""}</span>
          <ChevronDown className={expanded ? "rotated" : ""} size={14} />
        </button>
        <button className={`quiet ${filter ? "gold" : ""}`} onClick={onFilter}>
          {filter ? "Selected character" : "Everyone"}
        </button>
      </div>
      {expanded && (
        <div className="activity-feed" role="log" aria-label="Team activity">
          {events.length ? (
            events
              .slice(-30)
              .reverse()
              .map((e) => (
                <div className="activity-line" key={e.seq}>
                  <span className={`activity-type ${e.kind}`} />
                  <p>
                    {e.agentId && (
                      <strong
                        style={{
                          color: team.agents.find((a) => a.id === e.agentId)
                            ?.color,
                        }}
                      >
                        {team.agents.find((a) => a.id === e.agentId)?.name}{" "}
                      </strong>
                    )}
                    {e.text.length > 240 ? e.text.slice(0, 240) + "…" : e.text}
                  </p>
                  <time>
                    {new Date(e.at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
              ))
          ) : (
            <div className="activity-line">
              <span className="activity-type" />
              <p>
                Your crew is settling in. Start a task or take the office tour.
              </p>
              <span className="muted">
                {connected ? "Live" : "Reconnecting"}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
function SettingsPage({
  onOpenResets,
  manage,
  data,
  busy,
  save,
  reconnect,
  signIn,
  signOut,
  onImport,
  reduced,
  onReducedChange,
}: {
  onOpenResets: () => void;
  data: Snapshot;
  manage: (path: string, body: unknown) => Promise<unknown>;
  busy: boolean;
  reduced: boolean;
  onReducedChange: (value: boolean) => void;
  save: (t: Team) => Promise<unknown>;
  reconnect: () => Promise<unknown>;
  signIn: (provider: "codex" | "pixelcrew") => Promise<{ authUrl: string }>;
  signOut: () => Promise<unknown>;
  onImport: (file: File) => Promise<unknown>;
}) {
  const [name, setName] = useState(data.team.name);
  const [newTeamName, setNewTeamName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    setName(data.team.name);
    setConfirmDelete(false);
    setCreatingTeam(false);
    setNewTeamName("");
  }, [data.activeTeamId, data.team.name]);
  const [teamSection, setTeamSection] = useState(
    () => sessionStorage.getItem("pixelcrew-team-section") || "members",
  );
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [section, setSection] = useState("general");
  const importFile = useRef<HTMLInputElement>(null);
  const [loginLink, setLoginLink] = useState("");
  const [loginError, setLoginError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const accountProfiles = data.accounts?.profiles || [{ id: "desktop", label: "Desktop Codex", desktop: true }];
  const selectedAccount = data.accounts?.selected || "desktop";
  const selectedAuthType = data.accounts?.profiles.find(profile => profile.id === selectedAccount)?.authType;
  async function changeAccount(path: string, body: unknown) {
    setConnecting(true);
    setLoginError("");
    setLoginLink("");
    try {
      await api(path, "POST", body);

    } catch (error) { setLoginError((error as Error).message); }
    finally { setConnecting(false); }
  }
  useEffect(() => {
    if (data.runtime.authenticated) setLoginLink("");
  }, [data.runtime.authenticated]);
  async function logout() {
    setConnecting(true);
    setLoginError("");
    try {
      const result = await signOut() as { remoteRevocationConfirmed?: boolean; cancelled?: boolean };
      if (result.cancelled) return;
      setLoginLink("");
      if (result.remoteRevocationConfirmed === false) setLoginError("Account removed from PixelCrew. Remote session revocation could not be confirmed; you can disconnect PixelCrew in ChatGPT Settings.");
    } catch (error) {
      setLoginError((error as Error).message);
    } finally {
      setConnecting(false);
    }
  }
  async function login(addAccount = false, provider: "codex" | "pixelcrew" = "codex") {
    setConnecting(true);
    setLoginError("");
    const popup = window.open("about:blank", "codex-sign-in");
    try {
      const { authUrl } = addAccount
        ? await api<{ authUrl: string }>("/accounts", "POST", { provider })
        : await signIn(provider);
      setLoginLink(authUrl);
      if (popup) popup.location.href = authUrl;
    } catch (error) {
      popup?.close();
      setLoginError((error as Error).message);
    } finally {
      setConnecting(false);
    }
  }
  return (
    <section className="wide-page settings-page">
      <div className="page-heading">
        <div>
          <h1>Settings</h1>
        </div>
      </div>
      <nav className="settings-tabs" aria-label="Settings categories">
        {["general", "team", "usage", "models", "account"].map((item) => (
          <button
            key={item}
            className={section === item ? "active" : ""}
            aria-pressed={section === item}
            onClick={() => {
              setSection(item);
              sessionStorage.setItem("pixelcrew-settings-section", item);
            }}
          >
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>
      {section === "usage" && <UsageSettings runtime={data.runtime} onOpenResets={onOpenResets} />}
      {section === "general" && <>
        <section className="settings-card composer-settings">
          <h2>Composer</h2>
          <div className="composer-setting-row"><div><strong>Follow-up behavior</strong><p>Choose how Enter sends a message while a chat is working. Ctrl+Enter uses the opposite behavior for that message. Shift+Enter adds a new line.</p></div><div className="segmented-control" aria-label="Default follow-up behavior">{(["queue", "steer"] as const).map(value => <button key={value} className={data.preferences?.followupBehavior === value || !data.preferences?.followupBehavior && value === "queue" ? "active" : ""} aria-pressed={(data.preferences?.followupBehavior || "queue") === value} disabled={busy} onClick={() => void manage("/preferences", { key: "followupBehavior", value })}>{value === "queue" ? "Queue" : "Steer"}</button>)}</div></div>
        </section>
        <section className="settings-card composer-settings">
          <h2>Accessibility</h2>
          <label className="settings-switch">
            <span>
              <strong>Reduce motion</strong>
              <small>Keep the office still while preserving task status.</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label="Reduce motion"
              checked={reduced}
              onChange={(event) => onReducedChange(event.target.checked)}
            />
          </label>
        </section>
        {release.capabilities.deviceTools && <section className="settings-card composer-settings device-settings">
          <h2>Browser &amp; computer</h2>
          <p>Choose which local device connections PixelCrew chats may use. You can still choose tools separately in each chat.</p>
          <label className="settings-switch"><span><strong>Allow Chrome</strong><small>Allow chats to use your existing Chrome windows and signed-in sites. Chrome actions require approval.</small></span><input type="checkbox" checked={data.preferences?.allowChrome ?? false} disabled={busy} onChange={event => void manage("/preferences", { key: "allowChrome", value: event.target.checked })} /></label>
          {!data.deviceToolStatus?.chrome.available && <p className="connection-error">{data.deviceToolStatus?.chrome.reason || "Chrome connection unavailable."}</p>}
          <label className="settings-switch"><span><strong>Allow Windows computer</strong><small>Allow chats to inspect and control Windows apps. Actions require approval.</small></span><input type="checkbox" checked={data.preferences?.allowWindowsComputer ?? false} disabled={busy} onChange={event => void manage("/preferences", { key: "allowWindowsComputer", value: event.target.checked })} /></label>
          {!data.deviceToolStatus?.computer.available && <p className="connection-error">{data.deviceToolStatus?.computer.reason || "Windows Computer connection unavailable."}</p>}
          <p className="form-help">These are machine-wide switches. Turning one off blocks new and running tool calls. Chrome and Windows share one control queue across chats.</p>
        </section>}
      </>}

      <div className="settings-grid" data-section={section}>
        <section className="settings-card connection-card">
          <div className="connection-card-heading">
            <div className="connection-emblem"><Terminal size={25} /></div>
            <div><h2>Accounts</h2><p>Choose the account your crew works with.</p></div>
            <span className={`connection-status ${data.runtime.connected && data.runtime.authenticated ? "ready" : ""}`} role="status">
              <span />{data.accounts?.disconnected ? "Disconnected" : data.runtime.connected && data.runtime.authenticated ? "Connected" : data.runtime.authenticated ? "Offline" : "Sign-in needed"}
            </span>
          </div>
          <div className="connection-account">
            <div className="connection-account-icon"><ShieldCheck size={22} /></div>
            <div><span className="connection-eyebrow">ChatGPT account</span>
              <strong>{data.runtime.authenticated ? data.runtime.account || "Signed in with Codex" : "Bring your crew online"}</strong>
              <p>{data.accounts?.disconnected ? "Connect to resume with your saved sign-in." : selectedAccount === "desktop" ? "Managed in the Codex app. Sign out from Codex to remove its login." : "This account is saved separately for PixelCrew. Log out removes it and its saved credentials from this app."}</p>
            </div>
          </div>
          <label className="connection-profile-picker">Active account
            <select value={selectedAccount} disabled={connecting || busy} onChange={event => void changeAccount("/accounts/select", { id: event.target.value })}>
              {!accountProfiles.some(profile => profile.id === selectedAccount) && <option value={selectedAccount}>Sign-in in progress</option>}
              {accountProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
            </select>
          </label>
          <div className="connection-actions">
            <button className="secondary" disabled={connecting || busy} onClick={() => void login(true, "codex")}><Plus size={14} />Add account</button>
            <button className="secondary" disabled={connecting || busy} onClick={() => void login(true, "pixelcrew")}><Plus size={14} />Add PixelCrew account</button>
          </div>
          <p className="form-help">All chats stay visible across accounts. New work uses the selected account; running chats keep their current account until finished. Different chats can run on different accounts at the same time.</p>
          {data.runtime.error && <p role="alert" className="connection-error">{data.runtime.error}</p>}
          {loginError && <p role="alert" className="connection-error">{loginError}</p>}
          {loginLink && !data.runtime.authenticated && (
            <div className="connection-pending" role="status">
              <strong>Finish signing in in your browser</strong>
              <p>Then check the connection to continue.</p>
              <a href={loginLink} target="_blank" rel="noreferrer">Open sign-in again <ArrowUpRight size={14} /></a>
            </div>
          )}
          {selectedAccount !== "desktop" && selectedAuthType === "pending" && <p className="form-help">This account hasn’t finished sign-in. Continue with standard Codex sign-in, or use PixelCrew plan sign-in if eligible.</p>}
          {selectedAccount !== "desktop" && selectedAuthType === "pixelcrew" && <p className="form-help">This account uses PixelCrew sign-in and ChatGPT plan usage. Plan access depends on account and workspace eligibility.</p>}
          <div className="connection-actions">
            {selectedAccount !== "desktop" && <button className="secondary" disabled={connecting || busy} onClick={() => void logout()}>Log out</button>}
            {selectedAccount !== "desktop" && !data.accounts?.disconnected && !data.runtime.authenticated && <>
              <button className="primary" disabled={connecting || busy} onClick={() => void login(false, selectedAuthType === "pixelcrew" ? "pixelcrew" : "codex")}>
                {connecting ? "Opening sign-in..." : selectedAuthType === "pixelcrew" ? "Sign in again with PixelCrew" : selectedAuthType === "pending" ? "Retry standard sign-in" : "Continue with ChatGPT"}<ArrowUpRight size={15} />
              </button>
              {selectedAuthType !== "pixelcrew" && <button className="secondary" disabled={connecting || busy} onClick={() => void login(false, "pixelcrew")}>
                Sign in with PixelCrew plan access<ArrowUpRight size={15} />
              </button>}
            </>}
            <button className={data.runtime.authenticated ? "primary" : "secondary"} onClick={reconnect} disabled={busy || connecting}>
              <RotateCw size={15} />{busy ? "Checking connection…" : "Check connection"}
            </button>
          </div>
          <div className="connection-note"><ShieldCheck size={15} /><span>Log out removes a saved PixelCrew account and its credentials. Chats are kept. Desktop Codex sign-in is managed in Codex.</span></div>
          {selectedAccount === "desktop" && !data.runtime.authenticated && !data.accounts?.disconnected && <p className="form-help">Sign in through the Codex desktop app, then check the connection here. To use a separate login, add an account above.</p>}
        </section>
        <section className="settings-card">
          <div className="team-section-heading">
            <h2>
              <Armchair size={19} />
              Your team
            </h2>
            <button
              type="button"
              className="secondary"
              aria-expanded={creatingTeam}
              onClick={() => setCreatingTeam((value) => !value)}
            >
              <Plus size={14} />
              New team
            </button>
          </div>
          <label className="settings-team-selector">
            Selected team
            <TeamPicker
              teams={data.teams || [{ id: "default", name: data.team.name }]}
              value={data.activeTeamId || "default"}
              busy={busy}
              onChange={(id) => void manage(`/teams/${id}/activate`, {})}
            />
          </label>
          {creatingTeam && (
            <form
              className="team-create-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (newTeamName.trim())
                  void manage("/teams", { name: newTeamName.trim() }).then(
                    (saved) => {
                      if (saved) {
                        setNewTeamName("");
                        setCreatingTeam(false);
                      }
                    },
                  );
              }}
            >
              <input
                aria-label="New team name"
                placeholder="New team name"
                required
                maxLength={60}
                value={newTeamName}
                onChange={(event) => setNewTeamName(event.target.value)}
              />
              <button
                className="secondary"
                disabled={busy || !newTeamName.trim()}
              >
                Create team
              </button>
            </form>
          )}
          <nav
            className="team-settings-tabs"
            aria-label="Team settings sections"
          >
            {["members", "office", "manage"].map((item) => (
              <button
                type="button"
                key={item}
                aria-pressed={teamSection === item}
                className={teamSection === item ? "active" : ""}
                onClick={() => {
                  setTeamSection(item);
                  sessionStorage.setItem("pixelcrew-team-section", item);
                }}
              >
                {item === "members"
                  ? "Members"
                  : item === "office"
                    ? "Office design & layout"
                    : "Manage team"}
              </button>
            ))}
          </nav>
          {teamSection === "members" && (
            <TeamMembers
              team={data.team}
              busy={busy}
              save={save}
              catalog={data.catalog}
              models={data.runtime.models}
            />
          )}
          {teamSection === "office" && (
            <OfficeSettings
              data={data}
              busy={busy}
              manage={manage}
              showTeamPicker={false}
            />
          )}
          <div hidden={teamSection !== "manage"}>
            <form
              className="team-name-form"
              onSubmit={(e) => {
                e.preventDefault();
                void save({ ...data.team, name });
              }}
            >
              <label>
                Team name
                <input
                  value={name}
                  required
                  maxLength={60}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <button className="primary" disabled={busy}>
                Save name
              </button>
            </form>
            <div className="import-export">
              <a
                className="secondary transfer-button"
                href="/api/team/export"
                download
              >
                <Download size={14} />
                Export
              </a>
              <button
                type="button"
                className="secondary transfer-button"
                disabled={busy}
                onClick={() => importFile.current?.click()}
              >
                <Upload size={14} />
                Import
              </button>
              <input
                ref={importFile}
                hidden
                type="file"
                accept="application/json,.json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onImport(f);
                  e.target.value = "";
                }}
              />
            </div>
            <section className="team-danger">
              <h3>Danger zone</h3>
              <p>
                Remove this team and its saved office. Past chats and task
                results are kept.
              </p>
              <div className="team-delete">
                {!confirmDelete ? (
                  <button
                    type="button"
                    className="secondary team-delete-button"
                    disabled={busy || (data.teams?.length || 0) < 2}
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 size={14} aria-hidden="true" /> Delete this team
                  </button>
                ) : (
                  <div role="alert" className="delete-confirmation">
                    <strong>Delete {data.team.name}?</strong>
                    <p>
                      This removes the saved crew and its office. Past runs and
                      Codex chats are kept.
                    </p>
                    <div>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setConfirmDelete(false)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="danger secondary"
                        disabled={busy}
                        onClick={() =>
                          void manage(
                            `/teams/${data.activeTeamId || "default"}/delete`,
                            {},
                          )
                        }
                      >
                        Delete team
                      </button>
                    </div>
                  </div>
                )}
                {(data.teams?.length || 0) < 2 && (
                  <small>Keep at least one team.</small>
                )}
              </div>
            </section>

            <p className="form-help">
              Profiles are versioned. Active tasks keep the team snapshot they
              started with.
            </p>
          </div>
        </section>
        <section className="settings-card">
          <h2>
            <BookOpen size={19} />
            Available models
          </h2>
          {data.runtime.models.length ? (
            <div className="model-list">
              {data.runtime.models.map((m) => (
                <span key={m.id}>
                  {m.label}
                  <code>{m.id}</code>
                </span>
              ))}
            </div>
          ) : (
            <p>Connect Codex to discover models available to your account.</p>
          )}
        </section>
      </div>
    </section>
  );
}

function OfficeSettings({
  data,
  busy,
  manage,
  showTeamPicker = true,
}: {
  data: Snapshot;
  showTeamPicker?: boolean;
  busy: boolean;
  manage: (path: string, body: unknown) => Promise<unknown>;
}) {
  const selectedLayout =
    data.layoutPreset !== "custom" && data.layoutPreset
      ? data.layoutPreset
      : data.layoutBasePreset ||
        officeRoomPlanId(data.layout || {}) ||
        (!Object.keys(data.layout || {}).length ? "workshop" : undefined);
  const selectedPlan = officeLayouts.find(
    (preset) => preset.id === selectedLayout,
  );
  return (
    <div className="team-office-settings">
      <h2>Office appearance</h2>
      <p>
        Designing the office for <strong>{data.team.name}</strong>. Each team
        remembers its own background and furniture layout.
      </p>
      {showTeamPicker && (
        <label>
          Assign design to team
          <TeamPicker
            teams={data.teams || [{ id: "default", name: data.team.name }]}
            value={data.activeTeamId || "default"}
            busy={busy}
            onChange={(id) => void manage(`/teams/${id}/activate`, {})}
          />
        </label>
      )}
      <h3>Office background</h3>
      <div className="office-designs">
        {officeDesigns.map((design) => (
          <button
            type="button"
            key={design.id}
            className={`office-design-card ${data.officeDesign === design.id || (!data.officeDesign && design.id === "timber") ? "selected" : ""}`}
            aria-pressed={(data.officeDesign || "timber") === design.id}
            disabled={busy}
            onClick={() => void manage("/office/design", { id: design.id })}
          >
            <span
              className={`office-design-preview ${design.pattern}`}
              style={
                {
                  "--design-wall": design.wall,
                  "--design-floor": design.floor,
                  "--design-tile": design.tile,
                  "--design-grout": design.grout,
                } as React.CSSProperties
              }
            >
              <i />
              <b />
              <em />
            </span>
            <strong>{design.name}</strong>
            <small>{design.description}</small>
          </button>
        ))}
      </div>
      <h3>Rooms & furniture</h3>
      <p className="current-layout" role="status">
        Current layout:{" "}
        <strong>{selectedPlan?.name || "Custom arrangement"}</strong>
        {data.layoutPreset === "custom" &&
        Object.keys(data.layout || {}).length > 0 &&
        selectedPlan
          ? " · Customized furniture"
          : ""}
      </p>
      <p>
        Choose a floor plan, then drag furniture and wall sections in the
        office. Select an item to resize it, or use the arrow keys for small
        moves. Applying a plan replaces the current arrangement; Undo restores
        it.
      </p>
      <div className="layout-presets">
        {officeLayouts.map((preset) => (
          <button
            type="button"
            className={`layout-preset ${selectedLayout === preset.id ? "selected" : ""}`}
            aria-pressed={selectedLayout === preset.id}
            key={preset.id}
            disabled={busy}
            onClick={() => void manage("/layout/preset", { id: preset.id })}
          >
            {selectedLayout === preset.id && (
              <span className="preset-selection">
                <Check size={12} />
                Selected
              </span>
            )}
            <span className="layout-preview" aria-hidden="true">
              {roomPlans[preset.id]?.rooms.map((room) => (
                <span
                  key={room.name}
                  className={`plan-room ${room.material}`}
                  style={{
                    left: `${((room.x - 32) / 768) * 100}%`,
                    top: `${((room.y - 88) / 384) * 100}%`,
                    width: `${(room.width / 768) * 100}%`,
                    height: `${(room.height / 384) * 100}%`,
                  }}
                />
              ))}
              {roomPlans[preset.id]?.dividers.map(([x, y, w, h], index) => (
                <b
                  className="plan-divider"
                  key={index}
                  style={{
                    left: `${((x - 32) / 768) * 100}%`,
                    top: `${((y - 88) / 384) * 100}%`,
                    width: `${(w / 768) * 100}%`,
                    height: `${(h / 384) * 100}%`,
                  }}
                />
              ))}
              {preset.preview.map(([x, y], index) => (
                <i key={index} style={{ left: `${x}%`, top: `${y}%` }} />
              ))}
            </span>
            <strong>{preset.name}</strong>
            <small>{preset.description}</small>
          </button>
        ))}
      </div>
      <button
        className="quiet"
        disabled={busy}
        onClick={() => void manage("/layout/undo", {})}
      >
        Undo layout change
      </button>
    </div>
  );
}
