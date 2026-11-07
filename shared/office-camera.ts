export type CameraPoint = { x: number; y: number };
export const clampCameraZoom = (zoom: number) => Math.max(0.2, Math.min(3, zoom));
// Keep the world point under the cursor fixed as the camera zoom changes.
export function zoomAtCursor(pan: CameraPoint, oldZoom: number, newZoom: number, cursor: CameraPoint, viewport: CameraPoint): CameraPoint {
  const ratio = newZoom / oldZoom;
  return { x: (cursor.x - viewport.x / 2) * (1 - ratio) + pan.x * ratio,
    y: (cursor.y - viewport.y / 2) * (1 - ratio) + pan.y * ratio };
}
