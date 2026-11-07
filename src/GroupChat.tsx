import { ChatPermissionsContext } from "./ChatPermissions";
import { UsageLimitNotice } from "./ChatThread";
import { ThreadGoal } from "./ThreadGoal";
import { turnSegments } from "../shared/turn-segments";
import { usageLimitReached } from "../shared/usage-limit";
import { groupConversationTimeline } from "../shared/conversation-timeline";
import { spriteAsset } from "../shared/character-assets";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  Fragment,
  type ReactNode,
} from "react";
import { ArrowUpRight, ChevronDown, ClipboardList } from "lucide-react";
import type {
  Run,
  StudioEvent,
  ChatDetail,
  CodexChat,
  ChatTurn,
  Agent,
} from "../shared/types";
import { normalAgent } from "../shared/normal-agent";
import {
  conversationBusy,
  conversationBusyMessage,
} from "../shared/conversation-errors";
import { type GroupMessage, visibleGroupMessages } from "../shared/group-chat";
import { QuestionCard } from "./QuestionCard";
import { ChatContextUsage } from "./ContextMeter";
import {
  questionChoices,
  clarificationQuestion,
  readableResult,
} from "../shared/chat-presentation";
import {
  Markdown,
  UserMessage,
  Turn,
} from "./ChatThread";

export function GroupChat({
  sharedNormal,
  runs,
  events,
  chat,
  composer,
  onDetails,
  approvalUI,
  onAnswer,
  onRetry,
}: {
  sharedNormal?: Agent;
  runs: Run[];
  events: StudioEvent[];
  chat?: CodexChat;
  composer?: ReactNode;
  onDetails: () => void;
  approvalUI?: ReactNode;
  onAnswer?: (text: string) => Promise<unknown>;
  onRetry?: (run: Run) => void;
}) {
  const log = useRef<HTMLDivElement>(null),
    follow = useRef(true);
  const pane = useRef<HTMLElement>(null);
  const [native, setNative] = useState<ChatDetail>();
  const [nativeCursor, setNativeCursor] = useState<string>();
  const [historyError, setHistoryError] = useState("");
  const [loadingOlder, setLoadingOlder] = useState(false);
  const historyChat = useRef(chat?.id);
  historyChat.current = chat?.id;
  const olderAnchor = useRef<{ height: number; top: number } | undefined>(
    undefined,
  );
  const current = runs.at(-1),
    messages = visibleGroupMessages(runs, events, native?.turns || []).map(message =>
      message.direct && sharedNormal ? { ...message, agent: sharedNormal } : message,
    );
  useEffect(() => {
    let alive = true;
    setNative(undefined);
    setNativeCursor(undefined);
    setHistoryError("");
    setLoadingOlder(false);
    if (!chat) return;
    let initial = true;
    let reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      try {
        const r = await fetch(`/api/chats/${encodeURIComponent(chat.id)}`);
        const next = (await r.json()) as ChatDetail & { error?: string };
        if (!r.ok)
          throw Error(next.error || "Chat history could not be loaded.");
        if (alive) {
          setNative((previous) =>
            previous
              ? {
                  ...next,
                  turns: [
                    ...previous.turns.filter(
                      (turn) =>
                        !next.turns.some((current) => current.id === turn.id),
                    ),
                    ...next.turns,
                  ],
                }
              : next,
          );
          if (initial) {
            setNativeCursor(next.nextCursor);
            initial = false;
          }
          setHistoryError("");
        }
      } catch (error) {
        if (alive) setHistoryError(error instanceof TypeError ? "" : (error as Error).message);
      } finally {
        reading = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [chat?.id]);
  useLayoutEffect(() => {
    if (log.current && olderAnchor.current) {
      log.current.scrollTop =
        log.current.scrollHeight -
        olderAnchor.current.height +
        olderAnchor.current.top;
      olderAnchor.current = undefined;
    } else if (follow.current && log.current)
      log.current.scrollTop = log.current.scrollHeight;
  }, [JSON.stringify(messages), native]);
  useEffect(() => {
    follow.current = true;
  }, [chat?.id, current?.id]);
  async function loadOlder() {
    if (!chat || !nativeCursor || loadingOlder) return;
    const requested = chat.id;
    setLoadingOlder(true);
    try {
      const response = await fetch(
        `/api/chats/${encodeURIComponent(requested)}?cursor=${encodeURIComponent(nativeCursor)}`,
      );
      const next = (await response.json()) as ChatDetail & { error?: string };
      if (historyChat.current !== requested) return;
      if (!response.ok)
        throw Error(next.error || "Earlier messages could not be loaded.");
      if (log.current)
        olderAnchor.current = {
          height: log.current.scrollHeight,
          top: log.current.scrollTop,
        };
      follow.current = false;
      setNative((previous) =>
        previous
          ? {
              ...previous,
              turns: [
                ...next.turns.filter(
                  (turn) =>
                    !previous.turns.some((current) => current.id === turn.id),
                ),
                ...previous.turns,
              ],
            }
          : next,
      );
      setNativeCursor(next.nextCursor);
      setHistoryError("");
    } catch (error) {
      if (historyChat.current === requested)
        setHistoryError(error instanceof TypeError ? "" : (error as Error).message);
    } finally {
      if (historyChat.current === requested) setLoadingOlder(false);
    }
  }
  const timeline = groupConversationTimeline(messages, native?.turns || [], runs);
  return (
    <section ref={pane} className="group-chat" aria-label="Team group chat">
      <header className="group-chat-heading">
        <div>
          <strong>{chat?.name || current?.task || "Team chat"}</strong>
          <small>
            {current?.team.agents
              .filter((a) => a.enabled)
              .map((a) => a.name)
              .join(", ")}
          </small>
        </div>
        <button
          className="quiet"
          aria-label="View task details"
          onClick={onDetails}
        >
          <ClipboardList size={17} />
        </button>
        {chat && (
          <a
            className="quiet"
            href={`codex://threads/${encodeURIComponent(chat.id)}`}
            title="Open in Codex"
            aria-label="Open group chat in Codex"
          >
            <ArrowUpRight size={17} />
          </a>
        )}
      </header>
      {chat && <ThreadGoal key={chat.id} threadId={chat.id} />}
      {current && conversationBusy(current.error) && (
        <div className="conversation-busy" role="alert">
          <strong>Message not delivered</strong>
          <p>{conversationBusyMessage}</p>
          <button className="secondary" onClick={() => onRetry?.(current)}>
            Retry connection
          </button>
        </div>
      )}
      <div
        className="group-chat-log"
        ref={log}
        role="log"
        aria-label="Team conversation"
        onScroll={(event) => {
          const el = event.currentTarget;
          follow.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
      >
        {historyError && (
          <p role="alert" className="error-text">
            {historyError}
          </p>
        )}
        {nativeCursor && (
          <button
            className="quiet"
            disabled={loadingOlder}
            onClick={() => void loadOlder()}
          >
            {loadingOlder ? "Loading…" : "Earlier messages"}
          </button>
        )}
        {timeline.map((item) => {
          if (item.kind === "native")
            return current ? (
              <NativeChatTurn
                key={`native-${item.turn.id}`}
                turn={item.turn}
                chatId={chat!.id}
                agent={sharedNormal || normalAgent(
                  current.team.agents[0],
                )}
              />
            ) : null;
          const message = item.message;
          const assignment = runs.find(run => run.id === message.runId)?.assignments.find(assignment => assignment.id === message.assignmentId);
          if (message.role === "member" && usageLimitReached(assignment?.error) && (!assignment?.output || usageLimitReached(assignment.output))) return null;
          const owner = runs.find(run => run.id === message.runId);
          const recorded = native?.turns.find(turn => turn.id === assignment?.turnId);
          const steeringUsers = recorded?.users.filter(user => owner?.inbox?.some(entry => entry.text.trim() === user.text.trim())) || [];
          if (message.role === "member" && recorded?.sequence && steeringUsers.length && message.agent)
            return <NativeChatTurn key={message.id} turn={{ ...recorded, users: steeringUsers }} chatId={chat?.id || ""} agent={message.agent} childThreadId={assignment?.threadId !== chat?.id ? assignment?.threadId : undefined} />;
          return message.role === "user" ? (
            <div key={message.id} className="group-user">
              <UserMessage
                text={message.text}
                attachments={message.attachments}
                chatId={chat?.id || ""}
              />
              {message.status === "queued" && (
                <small>Queued for the team</small>
              )}
            </div>
          ) : (
            <article
              className={`group-member ${message.final ? "final-result" : ""}`}
              key={message.id}
            >
              <div className="member-message">
                <header>
                  <span
                    role="img"
                    aria-label={message.agent!.name}
                    className="group-avatar"
                    style={{
                      backgroundImage: `url(${spriteAsset(message.agent!)})`,
                    }}
                  />

                  <strong style={{ color: message.agent!.color }}>
                    {message.agent!.name}
                  </strong>
                  <small>{message.agent!.title}</small>
                  {assignment?.threadId && assignment.threadId !== chat?.id && (
                    <a href={`codex://threads/${encodeURIComponent(assignment.threadId)}`} title="Open saved subagent chat in Codex">Open in Codex ↗</a>
                  )}
                  {message.recipient && <span>→ {message.recipient}</span>}
                  <time>
                    {new Date(message.at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </header>
                {message.question ? (
                  <div
                    className="user-question"
                    role={message.awaitingReply ? "status" : undefined}
                  >
                    <strong>
                      {message.awaitingReply
                        ? `${message.agent!.name} is asking you`
                        : "Question to you · Answered"}
                    </strong>
                    <Markdown
                      text={
                        clarificationQuestion(message.question) ||
                        message.question
                      }
                      chatId={chat?.id}
                    />
                    {message.awaitingReply && (
                      <div>
                        <span>Waiting for your reply</span>
                        <button
                          type="button"
                          onClick={() =>
                            pane.current
                              ?.querySelector<HTMLButtonElement>(
                                ".question-options button, .question-card input",
                              )
                              ?.focus()
                          }
                        >
                          Reply to {message.agent!.name}
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <TeamMessageTurn
                    message={message}
                    runs={runs}
                    events={events}
                    chatId={chat?.id || ""}
                    nativeTurn={native?.turns.find(turn => turn.id === assignment?.turnId)}
                  />
                )}
              </div>
            </article>
          );
        })}
        {(usageLimitReached(current?.error) || usageLimitReached(native?.turns.at(-1)?.error)) && <UsageLimitNotice error={current?.error || native?.turns.at(-1)?.error} />}
        {!timeline.length && <p className="muted">Send a task to your team.</p>}
      </div>
      {approvalUI}
      {current?.question && onAnswer && (
        <QuestionCard
          key={current.question.assignmentId}
          sender={
            current.team.agents.find(
              (member) =>
                member.id ===
                current.assignments.find(
                  (a) => a.id === current.question?.assignmentId,
                )?.agentId,
            )?.name || "Teammate"
          }
          questions={[
            {
              id: "reply",
              question: (
                clarificationQuestion(current.question.text) ||
                current.question.text
              ).split(/\n\s*\n/)[0],
              options: questionChoices(current.question.text),
            },
          ]}
          onSend={(answers) => onAnswer(answers.reply)}
        />
      )}
      <ChatContextUsage.Provider
        value={
          native?.turns
            .slice()
            .reverse()
            .find((turn) => turn.context)?.context
        }
      >
        <ChatPermissionsContext.Provider
          value={{
            settings: native?.permissions,
            loaded: !!native,
            active: !!native?.active,
          }}
        >
          {composer}
        </ChatPermissionsContext.Provider>
      </ChatContextUsage.Provider>
    </section>
  );
}

/** Native-app turns have no Studio assignment; show the direct-chat persona. */
export function NativeChatTurn({
  turn,
  chatId,
  agent,
  childThreadId,
}: {
  turn: ChatTurn;
  chatId: string;
  agent: Agent;
  childThreadId?: string;
}) {
  if (
    !turn.users.length &&
    !turn.answers.length &&
    !turn.activity.length &&
    !turn.files.length &&
    turn.status !== "inProgress"
  )
    return null;
  return (
    <>{turnSegments(turn).map(({ turn: part, last }) => <Fragment key={part.id}>
      {part.users.map((message) => (
        <UserMessage
          key={message.id}
          text={message.text}
          attachments={message.attachments}
          chatId={chatId}
        />
      ))}
      <article className="group-member">
        <div className="member-message">
          <header>
            <span
              role="img"
              aria-label={agent.name}
              className="group-avatar"
              style={{ backgroundImage: `url(${spriteAsset(agent)})` }}
            />

            <strong style={{ color: agent.color }}>{agent.name}</strong>
            <small>{agent.title}</small>
            {childThreadId && <a href={`codex://threads/${encodeURIComponent(childThreadId)}`}>Open in Codex ↗</a>}
          </header>
          <Turn
            chatId={chatId}
            showSender={false}
            earlier={!last}
            turn={{
              ...part,
              users: [],
              answers: part.answers.map((answer) => ({
                ...answer,
                text: readableResult(answer.text),
              })),
            }}
          />
        </div>
      </article>
      </Fragment>)}
    </>
  );
}

/** Team and direct replies share the same timing, activity and answer layout. */
export function TeamMessageTurn({ message, runs, events, chatId, nativeTurn }: {
  message: GroupMessage;
  runs: Run[];
  events: StudioEvent[];
  chatId: string;
  nativeTurn?: ChatTurn;
}) {
  const assignment = runs.find(run => run.id === message.runId)
    ?.assignments.find(item => item.id === message.assignmentId);
  const active = ["running", "approval"].includes(message.status || "");
  const started = assignment?.startedAt ? Date.parse(assignment.startedAt) : undefined;
  const finished = assignment?.finishedAt ? Date.parse(assignment.finishedAt) : undefined;
  const durationMs = assignment?.metrics?.durationMs ??
    (started != null && finished != null ? Math.max(0, finished - started) : undefined);
  return <Turn chatId={chatId} showSender={false} turn={nativeTurn ? { ...nativeTurn, users: [] } : {
    id: message.id,
    status: active ? "inProgress" : message.status || "completed",
    error: assignment?.error,
    startedAt: started == null ? undefined : started / 1000,
    durationMs,
    model: assignment?.metrics?.actualModel || assignment?.model,
    usage: assignment?.metrics?.usage,
    users: [],
    answers: !active && message.text && message.text !== assignment?.error ? [{ id: message.id, text: message.text }] : [],
    activity: (() => {
      const activityEvents = events.filter(event => event.assignmentId === message.assignmentId &&
        (event.kind === "tool" || event.kind === "message" && event.text !== (active ? assignment?.error : message.text)));
      const latestTool = activityEvents.filter(event => event.kind === "tool").at(-1);
      const latestMessage = activityEvents.filter(event => event.kind === "message").at(-1);
      const commandIsRunning = active && latestTool && (!latestMessage || latestTool.seq > latestMessage.seq);
      return activityEvents.map(event => ({
        id: String(event.seq),
        type: event.kind === "message" ? "agentMessage" : "tool",
        title: event.kind === "tool" ? event.text : "Progress",
        text: event.kind === "message" ? event.text : "",
        status: event === latestTool && commandIsRunning ? "inProgress" : "completed",
      }));
    })()
      .concat(active && message.text && !events.some(event => event.assignmentId === message.assignmentId && event.kind === "message") ? [{ id: `${message.id}-progress`, type: "agentMessage", title: "Progress", text: message.text, status: "completed" }] : []),
    files: [],
  }} />;
}
