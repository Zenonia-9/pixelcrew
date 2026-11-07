import { useState } from "react";
import { createRoot } from "react-dom/client";
import { TaskModal } from "../../src/TaskComposer";
import { starterTeam } from "../../shared/defaults";
function Harness() {
  const [sent, setSent] = useState<string[]>([]);
  const [stops, setStops] = useState(0);
  return (
    <main style={{ maxWidth: 850, margin: "60px auto", padding: 20 }}>
      <h1>Running composer verification</h1>
      <TaskModal
        inline
        team={starterTeam}
        projects={[]}
        models={[
          { id: "gpt-6-luna", label: "GPT-6-Luna", efforts: ["low", "medium"] },
        ]}
        busy={false}
        connected
        error=""
        onClose={() => {}}
        running
        allowFollowup
        onInterrupt={() => setStops((n) => n + 1)}
        onCreate={async (input: any) => {
          setSent((previous) => [
            ...previous,
            `${input.options.delivery}: ${input.task}`,
          ]);
          return true;
        }}
      />
      <h2>Captured sends</h2>
      <ol aria-label="Captured sends">
        {sent.map((value, index) => (
          <li key={index}>{value}</li>
        ))}
      </ol>
      <p role="status">Stop calls: {stops}</p>
      <p>
        This harness captures submissions locally. It does not start Codex
        tasks.
      </p>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
