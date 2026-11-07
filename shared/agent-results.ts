export function planResult(
  raw: string,
  members: { id: string; role: string }[] = [],
) {
  try {
    return JSON.parse(raw);
  } catch {}
  const result: {
    summary: string;
    research: { agentId: string; objective: string }[];
    build: { agentId: string; objective: string }[];
  } = { summary: "", research: [], build: [] };
  let section: "summary" | "research" | "build" = "summary";
  let inferred = false;
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim().replace(/\*\*/g, "");
    const assignment = /^[-*]\s+([\w-]+)\s*:\s*(.+)$/.exec(line);
    const member = members.find((m) => m.id === assignment?.[1]);
    if (
      section === "summary" &&
      assignment &&
      member &&
      ["researcher", "builder"].includes(member.role)
    ) {
      result[member.role === "builder" ? "build" : "research"].push({
        agentId: member.id,
        objective: assignment[2],
      });
      inferred = true;
      continue;
    }
    if (/^#{0,3}\s*research\s*:?$/i.test(line)) {
      section = "research";
      continue;
    }
    if (/^#{0,3}\s*(build|implementation)\s*:?$/i.test(line)) {
      section = "build";
      continue;
    }
    if (section === "summary")
      result.summary +=
        (result.summary ? " " : "") + line.replace(/^#+\s*/, "");
    else {
      const match = /^[-*]\s+([\w-]+)\s*:\s*(.+)$/.exec(line);
      if (match)
        result[section].push({ agentId: match[1], objective: match[2] });
    }
  }
  if (
    !result.summary ||
    (!inferred &&
      (!/research/i.test(raw) || !/(build|implementation)/i.test(raw)))
  )
    throw Error(
      "The lead did not return the requested plan format. Retry planning.",
    );
  return result;
}
export function reviewResult(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {}
  const clean = raw
    .replace(/^#{1,3}\s+(?:Atlas|Pip|Bolt|Mira)\s*\n/i, "")
    .replace(/^#+\s*/, "")
    .replace(/\*\*/g, "")
    .trim();
  if (/^(?:PASS|PASSED|REVIEW PASSED)(?:\s*[:.\-—]|\s*$)/im.test(clean))
    return {
      passed: true,
      findings: clean.replace(
        /^(?:PASS|PASSED|REVIEW PASSED)\s*[:.\-—]?\s*/im,
        "",
      ),
    };
  if (/^CHANGES REQUESTED\b/i.test(clean))
    return {
      passed: false,
      findings: clean.replace(/^CHANGES REQUESTED\s*[:.\-]?\s*/i, ""),
    };
  throw Error(
    "The reviewer did not report PASS or CHANGES REQUESTED. Retry review.",
  );
}
