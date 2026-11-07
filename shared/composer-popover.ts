export type ComposerPopover = "add" | "permissions" | "model" | "goalBudget" | null;

export function toggleComposerPopover(
  current: ComposerPopover,
  next: Exclude<ComposerPopover, null>,
): ComposerPopover {
  return current === next ? null : next;
}
