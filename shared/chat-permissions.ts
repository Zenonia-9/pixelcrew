export interface ChatPermissions {
  mode: "ask" | "auto" | "custom";
  allowWrite: boolean;
  approvalPolicy: string;
  approvalsReviewer: string;
}
export function shouldInheritChatPermissions(
  sourceThreadId: string | undefined,
  permissionEdited: boolean,
) {
  return Boolean(sourceThreadId && !permissionEdited);
}
export function recordedPermissions(
  context: Record<string, any>,
): ChatPermissions | undefined {
  const policy = context.approval_policy;
  const sandbox = context.sandbox_policy?.type;
  if (typeof policy !== "string" || typeof sandbox !== "string") return;
  const reviewer =
    typeof context.approvals_reviewer === "string"
      ? context.approvals_reviewer
      : "user";
  return {
    mode:
      policy === "never"
        ? "custom"
        : ["auto_review", "guardian_subagent"].includes(reviewer)
          ? "auto"
          : ["on-request", "untrusted"].includes(policy)
            ? "ask"
            : "custom",
    allowWrite: !["read-only", "readOnly"].includes(sandbox),
    approvalPolicy: policy,
    approvalsReviewer: reviewer,
  };
}
