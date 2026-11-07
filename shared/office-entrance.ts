export const officeEntrance = {
  x: 796,
  y: 368,
  width: 48,
  height: 78,
  target: { x: 736, y: 392 },
};

// A rigid leaf rotates around one fixed hinge; its width never changes.
export function doorLeaf(
  x: number,
  y: number,
  width: number,
  open: number,
  axis: "x" | "y" = "x",
) {
  const angle =
    (axis === "y" ? Math.PI / 2 : 0) +
    Math.max(0, Math.min(1, open)) * Math.PI * 0.46;
  const along = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -along.y * 3, y: along.x * 3 };
  const end = { x: x + along.x * width, y: y + along.y * width };
  return {
    hinge: { x, y },
    end,
    backHinge: { x: x + normal.x, y: y + normal.y },
    backEnd: { x: end.x + normal.x, y: end.y + normal.y },
  };
}
