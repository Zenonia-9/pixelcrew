import { useState } from "react";
import { Brain, ChevronDown, ChevronRight, RotateCcw, Zap } from "lucide-react";
import type { RuntimeStatus } from "../shared/types";
const labels: Record<string, string> = {
  low: "Light",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
  ultra: "Ultra",
  minimal: "Minimal",
  none: "None",
};
export function ModelPicker({
  model,
  effort,
  models,
  open,
  onToggle,
  onClose,
  onChange,
}: {
  model: string;
  effort?: string;
  models: RuntimeStatus["models"];
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onChange: (model: string, effort?: string) => void;
}) {
  const [list, setList] = useState(false);
  const entry = models.find((m) => m.id === model),
    efforts = entry?.efforts || [];
  const index = efforts.indexOf(effort || "") + 1,
    label = effort ? labels[effort] || effort : "Auto";
  return (
    <div className="direct-model-controls">
      <button
        type="button"
        className="model-trigger"
        aria-label="Select model and effort"
        aria-expanded={open}
        onClick={onToggle}
      >
        <Brain className="model-compact-icon" size={18} />
        <span className="model-name">{entry?.label || "Auto"}</span>
        <span className="model-effort">{label}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div
          className="model-popover"
          role="group"
          aria-label="Model and effort settings"
        >
          <header>
            <Zap size={15} />
            <strong>{label}</strong>
            <button
              type="button"
              aria-label="Reset to Auto"
              onClick={() => onChange("", undefined)}
            >
              <RotateCcw size={14} />
            </button>
          </header>
          <button
            type="button"
            className="model-choice"
            aria-label="Choose model"
            aria-expanded={list}
            onClick={() => setList(!list)}
          >
            {entry?.label || "Auto model"}
            <ChevronRight size={13} />
          </button>
          {list && (
            <div
              className="model-options"
              role="listbox"
              aria-label="Available models"
            >
              {[{ id: "", label: "Auto" }, ...models].map((m) => (
                <button
                  type="button"
                  role="option"
                  key={m.id}
                  aria-selected={model === m.id}
                  onClick={() => {
                    const next = models.find((v) => v.id === m.id);
                    onChange(
                      m.id,
                      effort && next?.efforts?.includes(effort)
                        ? effort
                        : undefined,
                    );
                    setList(false);
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
          <label className="effort-slider">
            <span>Thinking effort</span>
            <input
              type="range"
              aria-label="Thinking effort"
              min="0"
              max={efforts.length}
              disabled={!efforts.length}
              step="1"
              value={Math.max(0, index)}
              onChange={(e) =>
                onChange(
                  model,
                  Number(e.target.value) === 0
                    ? undefined
                    : efforts[Number(e.target.value) - 1],
                )
              }
            />
            <span className="effort-labels">
              <small>Auto</small>
              <small>
                {efforts.length
                  ? labels[efforts.at(-1)!] || efforts.at(-1)
                  : "Choose a model"}
              </small>
            </span>
          </label>
          <button type="button" className="model-done" onClick={onClose}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}
