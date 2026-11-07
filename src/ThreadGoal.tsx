import { useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, ChevronDown, Circle, Pause, Pencil, Play, X } from "lucide-react";
import type { ThreadGoal as Goal } from "../shared/types";
import { MAX_GOAL_OBJECTIVE_LENGTH } from "../shared/types";
import { GoalReadGeneration } from "../shared/goal-read-generation";
import { formatGoalDuration } from "../shared/goal-format";
import {
  threadGoalCanEdit,
  threadGoalCanResume,
  threadGoalStatusAfterEdit,
} from "../shared/thread-goal-controls";

const SERVER_UNAVAILABLE = "PixelCrew server unavailable";

function goalReadError(failure: unknown) {
  const message = failure instanceof Error ? failure.message : String(failure);
  return failure instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(message)
    ? SERVER_UNAVAILABLE
    : message;
}

async function request(threadId: string, method = "GET", body?: unknown) {
  const payload = method === "GET" ? undefined : body ?? {};
  const response = await fetch(`/api/chats/${encodeURIComponent(threadId)}/goal`, {
    method,
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Could not update the goal.");
  return value as Goal | null;
}

export function ThreadGoal({ threadId }: { threadId: string }) {
  const [goal, setGoal] = useState<Goal | null>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [objectiveDraft, setObjectiveDraft] = useState("");
  const [budgetDraft, setBudgetDraft] = useState("");
  const readGeneration = useRef(new GoalReadGeneration());
  const mutationInFlight = useRef(false);

  useEffect(() => {
    readGeneration.current.invalidate();
    mutationInFlight.current = false;
    setBusy(false);
    setEditing(false);
    setExpanded(false);
    setError("");
    let alive = true;
    let loading = false;
    const read = async () => {
      if (loading || mutationInFlight.current) return;
      loading = true;
      const generation = readGeneration.current.begin();
      try {
        const next = await request(threadId);
        if (alive && readGeneration.current.isCurrent(generation)) {
          setGoal(next);
          setError("");
        }
      } catch (failure) {
        if (alive && readGeneration.current.isCurrent(generation)) {
          const message = failure instanceof Error ? failure.message : String(failure);
          // Goal lookup is optional for chats that have no goal. If Codex is
          // disconnected, keep any already loaded goal and omit the empty card.
          setError(/Codex is not connected/i.test(message) ? "" : goalReadError(failure));
        }
      } finally {
        loading = false;
      }
    };
    setGoal(undefined);
    setMutationError("");
    void read();
    const timer = setInterval(() => void read(), 5000);
    return () => {
      alive = false;
      readGeneration.current.invalidate();
      clearInterval(timer);
    };
  }, [threadId]);

  const update = async (method: string, body?: unknown) => {
    readGeneration.current.invalidate();
    const generation = readGeneration.current.begin();
    mutationInFlight.current = true;
    setBusy(true);
    setError("");
    setMutationError("");
    try {
      if (method === "DELETE") {
        await request(threadId, method, body);
        if (readGeneration.current.isCurrent(generation)) setGoal(null);
      } else {
        const next = await request(threadId, method, body);
        if (readGeneration.current.isCurrent(generation)) setGoal(next);
      }
    } catch (failure) {
      if (readGeneration.current.isCurrent(generation)) setMutationError((failure as Error).message);
    } finally {
      if (readGeneration.current.isCurrent(generation)) {
        mutationInFlight.current = false;
        setBusy(false);
      }
    }
  };

  const saveObjective = async () => {
    const budget = budgetDraft.trim() ? Number(budgetDraft) : null;
    if (!goal || !objectiveDraft.trim() || objectiveDraft.trim().length > MAX_GOAL_OBJECTIVE_LENGTH || (budget !== null && (!Number.isSafeInteger(budget) || budget < 1))) return;
    readGeneration.current.invalidate();
    const generation = readGeneration.current.begin();
    mutationInFlight.current = true;
    setBusy(true);
    setError("");
    setMutationError("");
    try {
      const next = await request(threadId, "PUT", {
        objective: objectiveDraft.trim(),
        status: threadGoalStatusAfterEdit(goal.status),
        tokenBudget: budget,
      });
      if (!readGeneration.current.isCurrent(generation)) return;
      setGoal(next);
      setEditing(false);
      setExpanded(false);
    } catch (failure) {
      if (readGeneration.current.isCurrent(generation)) setMutationError((failure as Error).message);
    } finally {
      if (readGeneration.current.isCurrent(generation)) {
        mutationInFlight.current = false;
        setBusy(false);
      }
    }
  };

  if (!goal) {
    if (!error) return null;
    return (
      <section className="thread-goal thread-goal-unavailable" aria-label="Thread goal" role="alert">
        <div className="thread-goal-icon" aria-hidden="true">
          <Circle size={16} />
        </div>
        <div className="thread-goal-copy">
          <strong>{error === SERVER_UNAVAILABLE ? "PixelCrew is offline" : "Goal unavailable"}</strong>
          <small className="goal-error">
            {error === SERVER_UNAVAILABLE
              ? "Restart the server to reconnect."
              : error}
          </small>
        </div>
      </section>
    );
  }
  const complete = goal.status === "complete";
  return (
    <section className={`thread-goal ${complete ? "complete" : ""}`} aria-label="Thread goal">
      <div className="thread-goal-icon" aria-hidden="true">
        {complete ? <CheckCircle2 size={17} /> : <Circle size={16} />}
      </div>
      <div className="thread-goal-copy">
        <button type="button" className="thread-goal-summary" aria-label={expanded ? "Collapse goal details" : "Expand goal details"} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
          <span className="thread-goal-title">
            <strong>{complete ? "Goal achieved" : "Goal"}</strong>
            <span className={`thread-goal-status ${goal.status}`}>{goal.status === "usageLimited" ? "Usage limit" : goal.status === "budgetLimited" ? "Budget reached" : goal.status}</span>
            <ChevronDown size={12} className={expanded ? "expanded" : ""} />
          </span>
          {!expanded && !editing && <span className="thread-goal-preview" title={goal.objective}>{goal.objective}</span>}
        </button>
        {editing ? (
          <div className="thread-goal-editor">
            <textarea
              aria-label="Goal objective"
              maxLength={MAX_GOAL_OBJECTIVE_LENGTH}
              rows={3}
              value={objectiveDraft}
              onChange={event => setObjectiveDraft(event.target.value)}
            />
            <label className="goal-edit-budget">
              Token budget
              <input
                aria-label="Goal token budget"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                placeholder="No budget"
                value={budgetDraft}
                onChange={event => setBudgetDraft(event.target.value)}
              />
            </label>
            <small>{objectiveDraft.length.toLocaleString()} / {MAX_GOAL_OBJECTIVE_LENGTH.toLocaleString()} characters · Changing the objective resets goal usage.</small>
            <div className="thread-goal-editor-actions">
              <button type="button" disabled={busy || !objectiveDraft.trim() || (budgetDraft.trim() !== "" && (!Number.isSafeInteger(Number(budgetDraft)) || Number(budgetDraft) < 1))} onClick={() => void saveObjective()}><Check size={13} /> Save</button>
              <button type="button" disabled={busy} onClick={() => { setEditing(false); setExpanded(false); }}>Cancel</button>
            </div>
          </div>
        ) : expanded && <p className="thread-goal-objective">{goal.objective}</p>}
        {(expanded || editing) && <small title="Codex's Goal budget counter; its accounting window differs from total turn usage, which includes cached input.">Goal budget used: {goal.tokensUsed.toLocaleString()}{goal.tokenBudget ? ` / ${goal.tokenBudget.toLocaleString()}` : ""} tokens · {formatGoalDuration(goal.timeUsedSeconds)}</small>}
        {(mutationError || error) && <small className="goal-error" role="alert">
          {/active writer|already.*writing/i.test(mutationError || error)
            ? <>Codex currently owns this chat. Resume the goal there, or switch to another chat in Codex and retry here. <a href={`codex://threads/${encodeURIComponent(threadId)}`}>Open in Codex ↗</a></>
            : mutationError || error}
        </small>}
      </div>
      <div className="thread-goal-actions">
        {!editing && threadGoalCanEdit(goal.status) && (
          <button type="button" className="quiet" disabled={busy} onClick={() => { setObjectiveDraft(goal.objective); setBudgetDraft(goal.tokenBudget?.toString() || ""); setExpanded(true); setEditing(true); }} aria-label="Edit goal" title="Edit goal"><Pencil size={14} /></button>
        )}
        {goal.status === "active" ? (
          <button type="button" className="quiet" disabled={busy} onClick={() => void update("PUT", { status: "paused" })} aria-label="Pause goal" title="Pause goal"><Pause size={14} /></button>
        ) : threadGoalCanResume(goal.status) ? (
          <button type="button" className="quiet" disabled={busy} onClick={() => void update("PUT", { status: "active" })} aria-label="Resume goal" title="Resume goal"><Play size={14} /></button>
        ) : null}
        <button type="button" className="quiet" disabled={busy} onClick={() => void update("DELETE")} aria-label="Clear goal" title="Clear goal"><X size={15} /></button>
      </div>
    </section>
  );
}
