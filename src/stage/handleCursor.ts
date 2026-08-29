/**
 * The mouse cursor for a resize handle, following the element's rotation.
 *
 * A handle on a box turned 90° grabs an edge that now runs the other way, so a
 * fixed cursor per corner points the wrong way as soon as anything is rotated.
 * Resize cursors are bidirectional — `ew-resize` is the same arrow whether the
 * edge is to the left or the right — so the answer only depends on the angle
 * modulo 180°, which lands the eight handles at any rotation on four cursors.
 */

import type { Handle } from './interactions';

/** Direction each handle points, clockwise from east, in screen degrees (y down). */
const HANDLE_ANGLE: Record<Handle, number> = {
  e: 0,
  se: 45,
  s: 90,
  sw: 135,
  w: 180,
  nw: 225,
  n: 270,
  ne: 315,
};

/** Indexed by the angle rounded to the nearest 45° within a half turn. */
const CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'] as const;

export type ResizeCursor = (typeof CURSORS)[number];

export function cursorForHandle(handle: Handle, rotation: number): ResizeCursor {
  const angle = HANDLE_ANGLE[handle] + rotation;
  // Rotation can be negative or past a full turn, so normalise before rounding.
  const half = ((angle % 180) + 180) % 180;
  return CURSORS[Math.round(half / 45) % CURSORS.length];
}
