import type { RuntimeStatus } from "../shared/types";
import { Gauge } from "lucide-react";
import { usageWindowLabel } from "../shared/account-usage";
import { useEffect, useRef } from "react";

export function AccountUsage({
  runtime,
  floating = false,
  compact = false,
  expanded = false,
  onOpenResets,
}: {
  runtime: RuntimeStatus;
  floating?: boolean;
  compact?: boolean;
  expanded?: boolean;
  onOpenResets?: () => void;
}) {
  const popover = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: Event) => {
      if (event.type === "keydown" && (event as KeyboardEvent).key !== "Escape")
        return;
      if (
        (event.type === "pointerdown" || event.type === "click") &&
        popover.current?.contains(event.target as Node)
      )
        return;
      if (popover.current && !expanded) popover.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, [expanded]);
  const buckets = (runtime.usage || []).map(bucket => ({
    ...bucket,
    windows: [...bucket.windows].sort((a, b) =>
      (a.windowDurationMins === 300 ? 0 : a.windowDurationMins ?? Infinity) -
      (b.windowDurationMins === 300 ? 0 : b.windowDurationMins ?? Infinity)),
  }));
  const windows = buckets.flatMap((bucket) => bucket.windows);
  const primary = buckets.find(bucket => bucket.id === "codex")?.windows.find(window => window.windowDurationMins === 300)
    || windows.find(window => window.windowDurationMins === 300)
    || windows[0];
  const remaining = primary?.remainingPercent;
  return (
    <details
      ref={popover}
      open={expanded || undefined}
      className={`account-usage ${floating ? "floating" : ""} ${expanded ? "expanded" : ""}`}
    >
      <summary aria-label="Codex usage remaining">
        {compact && <Gauge size={18} />}
        <span>Usage</span>
        <span>
          {runtime.usageError
            ? "Unavailable"
            : remaining === undefined
              ? "Unavailable"
              : `${remaining}% left`}
        </span>
      </summary>
      <div className="usage-popover">
        <strong>Usage remaining</strong>
        {runtime.usageError ? (
          <p role="status">Usage unavailable. Reconnecting automatically.</p>
        ) : !windows.length ? (
          <p>Codex has not reported usage limits.</p>
        ) : (
          buckets.map((bucket) => (
            <section key={bucket.id}>
              <h4>{bucket.label}</h4>
              {bucket.windows.map((window, index) => (
                <div className="usage-window" key={index}>
                  <div>
                    <span>{usageWindowLabel(window.windowDurationMins)}</span>
                    <strong>{window.remainingPercent}% left</strong>
                  </div>
                  <meter
                    min={0}
                    max={100}
                    value={window.remainingPercent}
                    aria-label={`${bucket.label} ${usageWindowLabel(window.windowDurationMins)} remaining`}
                  />
                  {window.resetsAt && (
                    <small>
                      Resets {new Date(window.resetsAt * 1000).toLocaleString()}
                    </small>
                  )}
                </div>
              ))}
            </section>
          ))
        )}
        {runtime.resetCredits && <section className="usage-reset-credits">
          <h4>Usage limit resets <button className="usage-reset-link" onClick={() => { if (popover.current && !expanded) popover.current.open = false; onOpenResets?.(); }}>{runtime.resetCredits.availableCount} available <span aria-hidden="true">›</span></button></h4>
        </section>}
        {runtime.usageUpdatedAt && (
          <small>
            Updated {new Date(runtime.usageUpdatedAt).toLocaleTimeString()}
          </small>
        )}
      </div>
    </details>
  );
}
