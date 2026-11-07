import { localFileReference } from "../shared/file-links";
import { turnSegments } from "../shared/turn-segments";
import { usageLimitReached, usageLimitMessage } from "../shared/usage-limit";
export function UsageLimitNotice({ error }: { error?: string }) {
  return <div role="status" className="chat-system-message usage-limit-notice"><span aria-hidden="true">ⓘ</span><span>{error && error.length > 50 ? error : usageLimitMessage}</span></div>;
}
import { LocalFileLink } from "./LocalFileLink";
import { ChatPermissionsContext } from "./ChatPermissions";
import { spriteAsset } from "../shared/character-assets";
import type { Agent } from "../shared/types";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowUpRight,
  ChevronDown,
  FileDiff,
  Terminal,
  Wrench,
  Globe,
  Loader2,
} from "lucide-react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChatContextUsage } from "./ContextMeter";
import { ThreadGoal } from "./ThreadGoal";
import {
  readableResult,
  localImagePath,
  normalizeLocalImageMarkdown,
  userContent,
  type ChatAttachment,
} from "../shared/chat-presentation";
import { ImagePreview } from "./ImagePreview";
import type {
  ChatDetail,
  ChatTurn,
  CodexChat,
  TokenUsage,
} from "../shared/types";
export const Markdown = memo(function Markdown({
  text,
  chatId,
}: {
  text: string;
  chatId?: string;
}) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url, key) => {
          if (key === "href" && localFileReference(url)) return url;
          const path = key === "src" && localImagePath(url);
          return path && chatId
            ? `/api/chats/${encodeURIComponent(chatId)}/attachment?path=${encodeURIComponent(path)}`
            : defaultUrlTransform(url);
        }}
        components={{
          img: ({ src, alt }) =>
            src && typeof src === "string" ? (
              <ImagePreview src={src} name={alt || "Image"} />
            ) : (
              <span>{alt}</span>
            ),
          a: ({ children, href, ...props }) => {
            const file = href && localFileReference(href);
            return file && chatId ? (
              <LocalFileLink chatId={chatId} file={file}>
                {children}
              </LocalFileLink>
            ) : (
              <a {...props} href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {normalizeLocalImageMarkdown(text)}
      </ReactMarkdown>
    </div>
  );
});
export const durationLabel = (ms?: number) =>
  ms == null
    ? "Timing unavailable"
    : ms < 1000
      ? "Worked for <1s"
      : `Worked for ${ms >= 60000 ? `${Math.floor(ms / 60000)}m ` : ""}${Math.floor(ms / 1000) % 60}s`;
export function Usage({ usage }: { usage?: TokenUsage }) {
  return usage ? (
    <details className="token-usage">
        <summary title="Total input and output for this turn, including cached input. This differs from Codex's Goal budget counter.">{usage.totalTokens.toLocaleString()} turn tokens</summary>
      <dl>
        <dt>Input</dt>
        <dd>{usage.inputTokens.toLocaleString()}</dd>
        <dt>Cached input</dt>
        <dd>{usage.cachedInputTokens.toLocaleString()}</dd>
        <dt>Output</dt>
        <dd>{usage.outputTokens.toLocaleString()}</dd>
        <dt>Reasoning output</dt>
        <dd>{usage.reasoningOutputTokens.toLocaleString()}</dd>
      </dl>
    </details>
  ) : (
    <span title="Codex did not record usage for this turn.">
      Tokens unavailable
    </span>
  );
}
function userText(text: string) {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed.task === "string")
      return { text: parsed.task, context: parsed.assignment };
  } catch {}
  return userContent(text);
}
export function UserMessage({
  text,
  attachments,
  chatId,
}: {
  text: string;
  attachments?: ChatAttachment[];
  chatId: string;
}) {
  const content = userContent(text, attachments);
  return (
    <article className="user-message" aria-label="Message from you">
      <span className="chat-sender user-sender">You</span>
      {!!content.attachments.length && (
        <div className="chat-attachments">
          {content.attachments.map((item) => {
            const url = `/api/chats/${encodeURIComponent(chatId)}/attachment?path=${encodeURIComponent(item.path)}`;
            return item.kind === "image" ? (
              <ImagePreview key={item.path} src={url} name={item.name} />
            ) : (
              <a key={item.path} href={url} download={item.name}>
                {item.name}
              </a>
            );
          })}
        </div>
      )}
      {content.text && (
        <div className="chat-message user">
          <details className="user-request">
            <summary>
              <span>{content.text}</span>
            </summary>
            <pre>{content.text}</pre>
          </details>
        </div>
      )}
    </article>
  );
}
export function ChatView({
  chat,
  composer,
  running,
  approvalUI,
  questionUI,
  runError,
  speaker,
  speakers,
}: {
  chat: CodexChat;
  speaker?: Agent;
  speakers?: Record<string, Agent>;
  composer?: ReactNode;
  running?: boolean;
  approvalUI?: ReactNode;
  questionUI?: ReactNode;
  runError?: string;
}) {
  const [data, setData] = useState<ChatDetail>(),
    [error, setError] = useState(""),
    [cursor, setCursor] = useState<string>(),
    [loadingOlder, setLoadingOlder] = useState(false);
  const messages = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const loadedChat = useRef("");
  const olderAnchor = useRef<{ height: number; top: number } | undefined>(
    undefined,
  );
  useLayoutEffect(() => {
    const element = messages.current;
    if (!element || !data) return;
    if (olderAnchor.current) {
      element.scrollTop =
        olderAnchor.current.top +
        element.scrollHeight -
        olderAnchor.current.height;
      olderAnchor.current = undefined;
    } else if (followLatest.current) element.scrollTop = element.scrollHeight;
  }, [data]);
  useEffect(() => {
    let alive = true,
      initial = true;
    if (loadedChat.current !== chat.id) {
      loadedChat.current = chat.id;
      followLatest.current = true;
      olderAnchor.current = undefined;
      setLoadingOlder(false);
      setData(undefined);
      setError("");
      setCursor(undefined);
    }
    let reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      try {
        const response = await fetch(
            `/api/chats/${encodeURIComponent(chat.id)}`,
          ),
          next = (await response.json()) as ChatDetail & { error?: string };
        if (!response.ok) throw new Error(next.error);
        if (alive) {
          setData((previous) =>
            previous
              ? {
                  ...next,
                  turns: [
                    ...previous.turns.filter(
                      (t) => !next.turns.some((n) => n.id === t.id),
                    ),
                    ...next.turns,
                  ],
                }
              : next,
          );
          if (initial) {
            setCursor(next.nextCursor);
            initial = false;
          }
          setError("");
        }
      } catch (e) {
        if (alive) setError(e instanceof TypeError ? "" : (e as Error).message);
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
  }, [chat.id, running]);
  const older = async () => {
    const requestedChat = chat.id;
    setLoadingOlder(true);
    try {
      const response = await fetch(
          `/api/chats/${encodeURIComponent(chat.id)}?cursor=${encodeURIComponent(cursor || "")}`,
        ),
        next = (await response.json()) as ChatDetail & { error?: string };
      if (!response.ok) throw new Error(next.error);
      if (loadedChat.current !== requestedChat) return;
      if (messages.current)
        olderAnchor.current = {
          height: messages.current.scrollHeight,
          top: messages.current.scrollTop,
        };
      followLatest.current = false;
      setData((previous) =>
        previous
          ? {
              ...previous,
              turns: [
                ...next.turns.filter(
                  (t) => !previous.turns.some((n) => n.id === t.id),
                ),
                ...previous.turns,
              ],
            }
          : next,
      );
      setCursor(next.nextCursor);
    } catch (e) {
      if (loadedChat.current === requestedChat) setError(e instanceof TypeError ? "" : (e as Error).message);
    } finally {
      if (loadedChat.current === requestedChat) setLoadingOlder(false);
    }
  };
  return (
    <section className="chat-page">
      <header className="chat-heading">
        <h1>{data?.name || chat.name}</h1>
        <a
          className="quiet"
          href={`codex://threads/${encodeURIComponent(chat.id)}`}
        >
          Open in Codex <ArrowUpRight size={14} />
        </a>
      </header>
      <ThreadGoal key={chat.id} threadId={chat.id} />
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {runError && !usageLimitReached(runError) && (
        <p role="alert" className="error-text chat-run-error">
          {runError.includes("active writer")
            ? "This chat is open for writing in another Codex session. Finish or release that session, then send your message again. Your chat history is preserved."
            : runError}
        </p>
      )}
      <div
        className="chat-messages"
        ref={messages}
        onScroll={(event) => {
          const element = event.currentTarget;
          followLatest.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            140;
        }}
      >
        {cursor && (
          <button
            className="quiet"
            disabled={loadingOlder}
            onClick={() => void older()}
          >
            {loadingOlder ? "Loading…" : "Earlier messages"}
          </button>
        )}
        {!data && !error && <p className="muted">Loading chat…</p>}
        {data?.turns.map((turn) => (
          <Turn
            key={turn.id}
            turn={turn}
            chatId={chat.id}
            speaker={speakers?.[turn.id] || speaker}
          />
        ))}
        {(usageLimitReached(data?.turns.at(-1)?.error) || usageLimitReached(runError)) && <UsageLimitNotice error={data?.turns.at(-1)?.error || runError} />}
        {data && !data.turns.length && (
          <p className="muted">No messages yet.</p>
        )}
        <span id="chat-end" />
      </div>
      <button
        className="jump-latest"
        aria-label="Jump to latest message"
        onClick={() => {
          followLatest.current = true;
          if (messages.current)
            messages.current.scrollTop = messages.current.scrollHeight;
        }}
      >
        <ArrowDown size={17} />
      </button>
      {approvalUI}
      {questionUI}
      <ChatContextUsage.Provider
        value={
          data?.turns
            .slice()
            .reverse()
            .find((turn) => turn.context)?.context
        }
      >
        <ChatPermissionsContext.Provider
          value={{
            settings: data?.permissions,
            loaded: !!data,
            active: !!data?.active,
          }}
        >
          {composer}
        </ChatPermissionsContext.Provider>
      </ChatContextUsage.Provider>
    </section>
  );
}
type TurnProps = { turn: ChatTurn; chatId: string; speaker?: Agent; showSender?: boolean; earlier?: boolean };
export function Turn(props: TurnProps) {
  return <>{turnSegments(props.turn).map(part => <TurnSegment key={part.turn.id} {...props} turn={part.turn} earlier={props.earlier || !part.last} />)}</>;
}
function TurnSegment({
  turn,
  chatId,
  speaker,
  showSender = true,
  earlier = false,
}: TurnProps & { earlier?: boolean }) {
  const activityGroups = turn.activity.reduce<ChatTurn["activity"][]>((groups, item) => {
    const previous = groups.at(-1);
    if (item.type === "agentMessage" || !previous || previous[0].type === "agentMessage") groups.push([item]);
    else previous.push(item);
    return groups;
  }, []);
  const elapsed =
    turn.durationMs ??
    (turn.status === "inProgress" && turn.startedAt
      ? Date.now() - turn.startedAt * 1000
      : undefined);
  return (
    <section className={`chat-turn${earlier ? " turn-continuation" : ""}`}>
      {turn.users.map((message) => (
        <UserMessage
          key={message.id}
          text={userText(message.text).text}
          attachments={message.attachments}
          chatId={chatId}
        />
      ))}
      <div className={showSender ? "assistant-turn" : "embedded-turn"}>
        {showSender && (
          <header className="chat-sender assistant-sender">
            <span
              className="group-avatar"
              role="img"
              aria-label={speaker?.name || "Codex"}
              style={{
                backgroundImage: `url(${speaker ? spriteAsset(speaker) : "/sprites/nova.png"})`,
              }}
            />
            <strong>{speaker?.name || "Codex"}</strong>
            <small>{speaker?.title || "Assistant"}</small>
          </header>
        )}
        <div className="turn-meta">
          <details
            className="turn-work"
            open={earlier || turn.status === "inProgress" || undefined}
          >
            <summary style={earlier ? { display: "none" } : undefined} aria-hidden={earlier || undefined}>
              {!earlier && <>{turn.status === "inProgress"
                ? elapsed == null
                  ? "Working…"
                  : durationLabel(elapsed).replace("Worked", "Working")
                : durationLabel(elapsed)}{" "}
              <ChevronDown size={13} /></>}
            </summary>
            <div className="turn-activity">
              {activityGroups.map(group => {
                const item = group[0];
                if (item.type === "agentMessage") return (
                  <article
                    className="chat-message assistant progress-message"
                    key={item.id}
                  >
                    <Markdown text={item.text} chatId={chatId} />
                  </article>
                );
                const running = group.some(tool => tool.status === "inProgress");
                const actions = [...new Set(group.map(tool => tool.type === "commandExecution" || tool.type === "tool" && /^(commandExecution|command)\s*:/i.test(tool.title) ? "Ran commands" : tool.type === "fileChange" ? "Edited files" : tool.type === "webSearch" ? "Searched the web" : "Used tools"))];
                const currentTool = group.find(tool => tool.status === "inProgress");
                const runningCommand = running && currentTool && (
                  currentTool.type === "commandExecution" ||
                  currentTool.type === "tool" && /^(commandExecution|command)\s*:/i.test(currentTool.title)
                );
                return <details className="tool-activity-group" key={item.id}>
                  <summary>{runningCommand ? <Loader2 size={14} className="spin" aria-label="Command running" /> : <Terminal size={14} />}<span>{runningCommand ? `Running ${currentTool.title}` : `${actions.join(", ")}${group.length > 1 ? ` · ${group.length}` : ""}`}</span></summary>
                  <div className="tool-group-items">{group.map(item => (
                    <details
                      key={item.id}
                      className={`tool-activity ${item.status === "inProgress" ? "running" : ""}`}
                    >
                      <summary>
                        {item.type === "commandExecution" ? (
                          <Terminal size={14} />
                        ) : item.type === "webSearch" ? (
                          <Globe size={14} />
                        ) : (
                          <Wrench size={14} />
                        )}
                        <span>{item.title}</span>
                        {item.status && (
                          <small>
                            {item.status === "inProgress"
                              ? "Running"
                              : item.status}
                          </small>
                        )}
                      </summary>
                      {item.text && <pre>{item.text}</pre>}
                    </details>
                  ))}</div>
                </details>;
              })}
            </div>
          </details>
          {!earlier && <><span>{turn.model}</span><Usage usage={turn.usage} /></>}
        </div>
        {turn.answers.filter(message => !usageLimitReached(message.text) || !usageLimitReached(turn.error)).map((message) => (
          <article className="chat-message assistant" key={message.id}>
            <Markdown text={readableResult(message.text)} chatId={chatId} />
          </article>
        ))}
        {!earlier && turn.status === "failed" && !usageLimitReached(turn.error) && (
          <p role="alert" className={usageLimitReached(turn.error) ? "usage-limit-notice" : "error-text"}>
            {usageLimitReached(turn.error) ? `ⓘ ${turn.error && turn.error.length > 50 ? turn.error : usageLimitMessage}` : turn.error || "This turn failed. Review its activity or open it in Codex."}
          </p>
        )}
        {turn.files.length > 0 && (
          <details className="turn-files">
            <summary>
              <FileDiff size={14} />
              {new Set(turn.files.map((f) => f.path)).size} files{" "}
              {turn.files.every((f) => f.status === "completed")
                ? "changed"
                : "proposed"}
              <span className="diff-added">
                +{turn.files.reduce((n, f) => n + f.added, 0)}
              </span>
              <span className="diff-removed">
                −{turn.files.reduce((n, f) => n + f.removed, 0)}
              </span>
            </summary>
            {turn.files.map((file, i) => (
              <details key={`${file.path}-${i}`}>
                <summary>
                  {file.path}
                  <small>{file.status}</small>
                </summary>
                <pre className="diff-code">
                  {file.diff.split("\n").map((line, i) => (
                    <span
                      key={i}
                      className={
                        line.startsWith("+")
                          ? "diff-added"
                          : line.startsWith("-")
                            ? "diff-removed"
                            : ""
                      }
                    >
                      {line}
                      {"\n"}
                    </span>
                  ))}
                </pre>
              </details>
            ))}
          </details>
        )}
      </div>
    </section>
  );
}
