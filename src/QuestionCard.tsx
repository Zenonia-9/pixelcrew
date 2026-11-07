import { useState } from "react";
import { ArrowRight, HelpCircle, Pencil, X, ChevronDown } from "lucide-react";
import { Dictation } from "./TaskComposer";
export type Question = {
  id: string;
  question: string;
  options?: { label: string; description?: string }[];
};
export function QuestionCard({
  questions,
  sender,
  onSend,
}: {
  questions: Question[];
  sender: string;
  onSend: (answers: Record<string, string>) => Promise<unknown>;
}) {
  const [index, setIndex] = useState(0),
    [answers, setAnswers] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, string[]>>({}),
    [custom, setCustom] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState(false),
    [sending, setSending] = useState(false),
    [listening, setListening] = useState(false),
    [error, setError] = useState("");
  const question = questions[index];
  if (!question) return null;
  const multiple = /select all|choose all|multiple|all that apply/i.test(
    question.question,
  );
  const value =
    custom[question.id]?.trim() || (selected[question.id] || []).join("; ");
  const submit = async (skip = false) => {
    if (sending || (!skip && !value)) return;
    const next = {
      ...answers,
      [question.id]: skip ? "Skipped by user." : value,
    };
    if (index < questions.length - 1) {
      setAnswers(next);
      setIndex(index + 1);
      return;
    }
    setSending(true);
    setError("");
    try {
      const result = await onSend(next);
      if (result === false) setError("Could not send your answer. Try again.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };
  return (
    <section
      className={`question-card ${collapsed ? "question-collapsed" : ""}`}
      aria-label={`Question from ${sender}`}
      onKeyDown={(event) => {
        if (
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement
        )
          return;
        const option = question.options?.[Number(event.key) - 1];
        if (option && /^[1-9]$/.test(event.key)) {
          event.preventDefault();
          setSelected((previous) => ({
            ...previous,
            [question.id]: multiple
              ? [...new Set([...(previous[question.id] || []), option.label])]
              : [option.label],
          }));
          setCustom((previous) => ({ ...previous, [question.id]: "" }));
        }
      }}
    >
      <header>
        <span>
          <HelpCircle size={14} />
          Question{" "}
          <small>
            {sender} → You
            {questions.length > 1 ? ` · ${index + 1}/${questions.length}` : ""}
          </small>
        </span>
        <button
          type="button"
          aria-label={collapsed ? "Show question" : "Collapse question"}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronDown size={15} /> : <X size={15} />}
        </button>
      </header>
      {!collapsed && (
        <>
          <h3>{question.question}</h3>
          <div
            className="question-options"
            role="group"
            aria-label={multiple ? "Select all that apply" : "Choose an answer"}
          >
            {question.options?.map((option, optionIndex) => (
              <button
                type="button"
                key={option.label}
                disabled={sending}
                aria-pressed={
                  (selected[question.id] || []).includes(option.label) &&
                  !custom[question.id]
                }
                onClick={() => {
                  setCustom((previous) => ({ ...previous, [question.id]: "" }));
                  setSelected((previous) => {
                    const values = previous[question.id] || [];
                    return {
                      ...previous,
                      [question.id]: multiple
                        ? values.includes(option.label)
                          ? values.filter((v) => v !== option.label)
                          : [...values, option.label]
                        : [option.label],
                    };
                  });
                }}
              >
                <span className="question-number">{optionIndex + 1}</span>
                <span className="question-option-copy">
                  <strong>{option.label}</strong>
                  {option.description && <small>{option.description}</small>}
                </span>
                <ArrowRight className="question-option-arrow" size={16} />
              </button>
            ))}
          </div>
          <footer>
            <label className="question-custom">
              <Pencil size={15} />
              <input
                aria-label="Write your own response"
                placeholder="Or write your own response"
                value={custom[question.id] || ""}
                disabled={sending}
                onChange={(event) =>
                  setCustom((previous) => ({
                    ...previous,
                    [question.id]: event.target.value,
                  }))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void submit();
                  }
                }}
              />
            </label>
            <Dictation
              onText={(text) =>
                setCustom((previous) => ({
                  ...previous,
                  [question.id]: previous[question.id]
                    ? `${previous[question.id]} ${text}`
                    : text,
                }))
              }
              onError={setError}
              onListening={setListening}
            />
            <button
              type="button"
              className="question-skip"
              disabled={sending || listening}
              onClick={() => void submit(true)}
            >
              Skip
            </button>
            <button
              type="button"
              className="question-send"
              disabled={sending || listening || !value}
              onClick={() => void submit()}
            >
              {sending
                ? "Sending…"
                : index < questions.length - 1
                  ? "Next"
                  : "Send"}
            </button>
          </footer>
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
