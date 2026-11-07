import { createContext, useContext, useEffect, useRef, useState } from "react";
export const ChatContextUsage = createContext<
  { used: number; limit: number } | undefined
>(undefined);
export function ContextMeter() {
  const usage = useContext(ChatContextUsage),
    [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event.type === "keydown" && (event as KeyboardEvent).key !== "Escape")
        return;
      if (
        event.type === "pointerdown" &&
        root.current?.contains(event.target as Node)
      )
        return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const percent =
    usage && usage.limit > 0
      ? Math.min(100, Math.round((100 * usage.used) / usage.limit))
      : undefined;
  return (
    <div
      className="context-control"
      ref={root}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="Context window"
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        title={
          percent === undefined
            ? "Context window unavailable"
            : `${percent}% of context window used`
        }
        onClick={() => setOpen(!open)}
      >
        <svg width="17" height="17" viewBox="0 0 20 20" aria-hidden="true">
          <circle
            cx="10"
            cy="10"
            r="7"
            fill="none"
            stroke="currentColor"
            opacity=".25"
            strokeWidth="2"
          />
          <circle
            cx="10"
            cy="10"
            r="7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            pathLength="100"
            strokeDasharray={`${percent || 0} 100`}
            transform="rotate(-90 10 10)"
          />
        </svg>
      </button>
      {open && (
        <div className="context-popover" role="tooltip">
          <span>Context window:</span>
          {usage && percent !== undefined ? (
            <>
              <strong>{percent}% full</strong>
              <small>
                {usage.used >= 1000
                  ? `${Math.round(usage.used / 1000)}k`
                  : usage.used.toLocaleString()}{" "}
                /{" "}
                {usage.limit >= 1000
                  ? `${Math.round(usage.limit / 1000)}k`
                  : usage.limit.toLocaleString()}{" "}
                tokens used
              </small>
            </>
          ) : (
            <span>Codex has not reported context usage for this chat.</span>
          )}
        </div>
      )}
    </div>
  );
}
