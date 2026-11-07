export const MIN_OFFICE_ZOOM = 0.5;
export const MAX_OFFICE_ZOOM = 2;

export function stepOfficeZoom(zoom: number, direction: -1 | 1): number {
  return Math.min(
    MAX_OFFICE_ZOOM,
    Math.max(MIN_OFFICE_ZOOM, Math.round((zoom + direction * 0.1) * 10) / 10),
  );
}

export function fitOfficeZoom(width: number, height: number): number {
  return Math.min(
    MAX_OFFICE_ZOOM,
    Math.max(
      MIN_OFFICE_ZOOM,
      Math.floor(Math.min(width / ROOM_WIDTH, height / ROOM_HEIGHT) * 10) / 10,
    ),
  );
}
import { ROOM_WIDTH, ROOM_HEIGHT } from "./room-dimensions";
