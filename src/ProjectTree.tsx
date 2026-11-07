import { useEffect, useState } from "react";
import {
  ChevronDown,
  Folder,
  FolderOpen,
  Loader2,
  Plus,
  RotateCw,
  Pin,
  PinOff,
  AlertCircle,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";
import type { CodexChat, CodexProject, Run } from "../shared/types";

const CHATS_PER_EXPANSION = 5;

export function ProjectTree({
  titleRevision,
  projects,
  runs = [],
  activeChats = [],
  completedChatIds = [],
  readCompletedChatIds = [],
  selected,
  chatId,
  onChat,
  onNew,
  pinnedProjects,
  onPinnedChange,
}: {
  projects: CodexProject[];
  titleRevision?: number;
  runs?: Run[];
  activeChats?: string[];
  completedChatIds?: string[];
  readCompletedChatIds?: string[];
  selected?: string;
  chatId?: string;
  onChat: (chat: CodexChat, project: CodexProject) => void;
  onNew: (project: CodexProject) => void;
  pinnedProjects?: string[];
  onPinnedChange?: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState<string[]>(() => {
    try {
      const value = JSON.parse(
        localStorage.getItem("hearth-open-folders") || "[]",
      );
      return Array.isArray(value)
        ? value.filter((id) => typeof id === "string")
        : [];
    } catch {
      return [];
    }
  });
  const [pinned, setPinned] = useState<string[]>(() => {
    if (pinnedProjects !== undefined) return pinnedProjects;
    try {
      const value = JSON.parse(
        localStorage.getItem("hearth-pinned-projects") || "[]",
      );
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    if (pinnedProjects !== undefined) setPinned(pinnedProjects);
  }, [JSON.stringify(pinnedProjects)]);
  useEffect(() => {
    if (pinned.length && pinnedProjects === undefined) onPinnedChange?.(pinned);
  }, []);
  return (
    <div className="project-tree">
      {pinned.some((id) => projects.some((p) => p.id === id)) && (
        <div className="project-group-label">Pinned</div>
      )}
      {[
        ...projects.filter((p) => pinned.includes(p.id)),
        ...projects.filter((p) => !pinned.includes(p.id)),
      ].map((p, index, all) => (
        <div key={p.id}>
          {index > 0 &&
            !pinned.includes(p.id) &&
            pinned.includes(all[index - 1].id) && (
              <div className="project-group-label">Projects</div>
            )}
          <ProjectFolder
            titleRevision={titleRevision}
            key={p.id}
            project={p}
            runs={runs}
            activeChats={activeChats}
            completedChatIds={completedChatIds}
            readCompletedChatIds={readCompletedChatIds}
            selected={selected === p.id}
            chatId={chatId}
            open={open.includes(p.id)}
            toggle={() => {
              const next = open.includes(p.id)
                ? open.filter((id) => id !== p.id)
                : [...open, p.id];
              setOpen(next);
              localStorage.setItem("hearth-open-folders", JSON.stringify(next));
            }}
            onChat={(chat) => onChat(chat, p)}
            onNew={() => onNew(p)}
            pinned={pinned.includes(p.id)}
            onPin={() => {
              const next = pinned.includes(p.id)
                ? pinned.filter((id) => id !== p.id)
                : [...pinned, p.id];
              setPinned(next);
              onPinnedChange?.(next);
              localStorage.setItem(
                "hearth-pinned-projects",
                JSON.stringify(next),
              );
            }}
          />
        </div>
      ))}
    </div>
  );
}
function ProjectFolder({
  titleRevision,
  project,
  runs,
  activeChats,
  completedChatIds,
  readCompletedChatIds,
  selected,
  chatId,
  open,
  toggle,
  onChat,
  onNew,
  pinned,
  onPin,
}: {
  project: CodexProject;
  titleRevision?: number;
  runs: Run[];
  activeChats: string[];
  completedChatIds: string[];
  readCompletedChatIds: string[];
  selected: boolean;
  chatId?: string;
  open: boolean;
  toggle: () => void;
  onChat: (c: CodexChat) => void;
  onNew: () => void;
  pinned: boolean;
  onPin: () => void;
}) {
  const [chats, setChats] = useState<CodexChat[]>([]),
    [cursor, setCursor] = useState<string>(),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [visibleCount, setVisibleCount] = useState(CHATS_PER_EXPANSION);
  const load = async (append = false, preserveVisible = false) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/chats?projectId=${encodeURIComponent(project.id)}${append && cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (!Array.isArray(data.chats))
        throw new Error("Chats could not be loaded. Try Refresh.");
      setChats((previous) =>
        append
          ? [...previous, ...data.chats].filter(
              (c, i, all) => all.findIndex((x) => x.id === c.id) === i,
            )
          : data.chats,
      );
      if (append) setVisibleCount((previous) => previous + CHATS_PER_EXPANSION);
      else if (!preserveVisible) setVisibleCount(CHATS_PER_EXPANSION);
      setCursor(data.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (!open) return;
    void load();
    const timer = setInterval(() => {
      void load(false, true);
    }, 30000);
    return () => clearInterval(timer);
  }, [open, project.id, titleRevision]);
  return (
    <section className="project-folder">
      <div className={`folder-row ${selected ? "selected" : ""}`}>
        <button
          className="folder-toggle"
          aria-expanded={open}
          aria-label={project.name}
          title={project.roots.join("\n")}
          onClick={toggle}
        >
          <ChevronDown size={12} className={open ? "" : "folded"} />
          {open ? <FolderOpen size={15} /> : <Folder size={15} />}
          <span>{project.name}</span>
        </button>
        <button
          className={`project-pin ${pinned ? "is-pinned" : ""}`}
          aria-label={`${pinned ? "Unpin" : "Pin"} ${project.name}`}
          title={pinned ? "Unpin in Studio" : "Pin in Studio"}
          aria-pressed={pinned}
          onClick={onPin}
        >
          {pinned ? <PinOff size={13} /> : <Pin size={13} />}
        </button>
        <button
          aria-label={`New task in ${project.name}`}
          title="New task"
          onClick={onNew}
        >
          <Plus size={14} />
        </button>
      </div>
      {open && (
        <div className="folder-chats" aria-label={`${project.name} chats`}>
          {chats.slice(0, visibleCount).map((c) => {
            const matching = runs.filter(r => r.chatThreadId === c.id || r.options?.sourceThreadId === c.id || r.assignments.some(a => a.threadId === c.id));
            const run = matching.find(r => ["queued", "running", "approval"].includes(r.status)) || matching[0];
            const unread = completedChatIds.includes(c.id) && !readCompletedChatIds.includes(c.id);
            const signal = run?.question || c.statusFlags?.includes("waitingOnUserInput") ? "answer" : run?.status === "approval" || c.statusFlags?.includes("waitingOnApproval") ? "approval" : activeChats.includes(c.id) || ["running", "queued"].includes(run?.status || "") ? "working" : run?.status === "failed" || c.status === "systemError" ? "error" : unread ? "unread" : c.status === "active" ? "working" : "";
            return (
            <button
              key={c.id}
              title={c.name}
              className={`chat-link ${chatId === c.id ? "selected" : ""}`}
              onClick={() => onChat(c)}
            >
              <span>{c.name}</span>
              {signal === "working" && <Loader2 size={13} className="spin" aria-label="Working" />}
              {signal === "approval" && <ShieldCheck size={13} className="chat-signal waiting" aria-label="Approval needed" />}
              {signal === "answer" && <MessageCircle size={13} className="chat-signal waiting" aria-label="Answer needed" />}
              {signal === "error" && <AlertCircle size={13} className="chat-signal error" aria-label="Chat failed" />}
              {signal === "unread" && <i className="chat-signal unread" aria-label="Finished chat not yet viewed" title="Finished chat" />}
            </button>
          ); })}
          {!chats.length && !loading && !error && (
            <span className="muted folder-empty">No chats</span>
          )}
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <div className="folder-more">
            {loading ? (
              <Loader2 size={13} className="spin" />
            ) : (
              <button
                aria-label={`Refresh ${project.name} chats`}
                title="Refresh chats"
                onClick={() => void load()}
              >
                <RotateCw size={12} />
              </button>
            )}
            {(visibleCount < chats.length || cursor) && (
              <button
                disabled={loading}
                onClick={() => {
                  if (visibleCount < chats.length)
                    setVisibleCount((count) => count + CHATS_PER_EXPANSION);
                  else void load(true);
                }}
              >
                Show more...
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
