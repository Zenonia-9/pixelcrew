import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export function TeamPicker({
  teams,
  value,
  busy,
  onChange,
}: {
  teams: { id: string; name: string }[];
  value: string;
  busy: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    root.current
      ?.querySelector<HTMLButtonElement>(
        '[role="menuitemradio"][aria-checked="true"]',
      )
      ?.focus();
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  return (
    <div
      className="office-team-picker"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setOpen(false);
          trigger.current?.focus();
        }
        if (event.key === "Tab") setOpen(false);
        if (
          open &&
          ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
        ) {
          event.preventDefault();
          const items = Array.from(
            root.current?.querySelectorAll<HTMLButtonElement>(
              '[role="menuitemradio"]',
            ) || [],
          );
          const index = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (index +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    items.length) %
                  items.length;
          items[next]?.focus();
        }
      }}
    >
      <button
        type="button"
        ref={trigger}
        className="office-team-trigger"
        aria-label="Active team"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (!open && ["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span>
          {teams.find((team) => team.id === value)?.name || "Select team"}
        </span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="office-team-menu" role="menu" aria-label="Switch team">
          <span className="office-team-menu-label">Your teams</span>
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              role="menuitemradio"
              aria-checked={team.id === value}
              disabled={busy}
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
                if (team.id !== value) onChange(team.id);
              }}
            >
              <span>{team.name}</span>
              {team.id === value && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
