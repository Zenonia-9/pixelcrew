export const SIDEBAR_RAIL_WIDTH = 68;
export const MIN_INSPECTOR_WIDTH = 360;
export function sidebarSize(width: number) {
  if (!Number.isFinite(width)) return 260;
  return width < 200 ? SIDEBAR_RAIL_WIDTH : Math.min(420, Math.round(width));
}
export function profileSize(width: number, availableWidth: number) {
  const maximum = Math.max(0, availableWidth - 7);
  return Math.round(
    Math.max(
      Math.min(MIN_INSPECTOR_WIDTH, maximum),
      Math.min(maximum, Number.isFinite(width) ? width : MIN_INSPECTOR_WIDTH),
    ),
  );
}
