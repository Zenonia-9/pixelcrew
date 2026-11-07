import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { RuntimeStatus } from "../shared/types";
import { usageWindowLabel } from "../shared/account-usage";
export function UsageResetDialog({ runtime, accountId, onClose }: { runtime: RuntimeStatus; accountId: string; onClose: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const attempts = useRef(new Map<string, string>());
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); }; document.addEventListener("keydown", key); dialog.current?.focus(); return () => document.removeEventListener("keydown", key); }, [busy]);
  async function redeem(creditId?: string) {
    if (busy) return;
    const key = creditId || "next"; if (!attempts.current.has(key)) attempts.current.set(key, crypto.randomUUID());
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/usage/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creditId, accountId, idempotencyKey: attempts.current.get(key) }) });
      const result = await response.json(); if (!response.ok) throw Error(result.error);
      setMessage(({ reset: "Your usage limits have been reset.", alreadyRedeemed: "This reset has already been applied.", nothingToReset: "No usage window is eligible for a reset yet.", noCredit: "No resets are currently available." } as Record<string,string>)[result.outcome] || "Usage updated.");
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  const credits = runtime.resetCredits;
  return <div className="usage-reset-backdrop" onPointerDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Usage" className="usage-reset-dialog">
    <header><h2>Usage</h2><button aria-label="Close Usage" disabled={busy} onClick={onClose}><X size={17} /></button></header>
    <div className="reset-limit-windows">{runtime.usage?.flatMap(bucket => [...bucket.windows].sort((a,b) => (a.windowDurationMins || Infinity) - (b.windowDurationMins || Infinity)).map((window, index) => <div key={`${bucket.id}:${index}`}><div><strong>{usageWindowLabel(window.windowDurationMins)} usage limit</strong><small>{window.resetsAt ? `Resets ${new Date(window.resetsAt * 1000).toLocaleString()}` : "Reset time unavailable"}</small></div><meter min={0} max={100} value={window.remainingPercent} /><span>{window.remainingPercent}% left</span></div>))}</div>
    <section className="reset-credit-list"><h3>Usage limit resets <span>{credits?.availableCount ?? "—"} available</span></h3>
      {credits?.credits?.map(credit => <div className="reset-credit-row" key={credit.id}><div><strong>{credit.title}</strong>{credit.expiresAt && <small>Expires {new Date(credit.expiresAt * 1000).toLocaleString()}</small>}</div><button className="primary" disabled={busy} onClick={() => void redeem(credit.id)}>{busy ? "Applying…" : "Use reset"}</button></div>)}
      {credits?.availableCount && !credits.credits?.length ? <button className="primary" disabled={busy} onClick={() => void redeem()}>Use reset</button> : null}
      {credits?.availableCount === 0 && <p>No resets available.</p>}
      {!credits && <p>Reset availability has not been reported.</p>}
    </section>{error && <p role="alert" className="error-text">{error}</p>}{message && <p role="status">{message}</p>}
  </div></div>;
}
