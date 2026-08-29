/**
 * The readout that follows a gesture.
 *
 * Dragging without numbers means checking the inspector afterwards to find out
 * what actually happened. PowerPoint shows the figure while the pointer is
 * down, so the value can be aimed at rather than corrected.
 *
 * Everything here is in design pixels — the stage's own coordinate space —
 * because that is what the inspector shows and what the HTML carries. Screen
 * pixels would change meaning with the zoom.
 */

import { boundsOf, round, type OrientedBox } from './geometry';

export type MeasureKind = 'move' | 'resize' | 'rotate';

export interface GestureMeasure {
  kind: MeasureKind;
  box: OrientedBox;
}

export function formatMeasure({ kind, box }: GestureMeasure): string {
  switch (kind) {
    case 'move': {
      // The top-left of the axis-aligned bounds, which is the corner the
      // inspector's X/Y refers to.
      const bounds = boundsOf(box);
      return `${whole(bounds.left)}, ${whole(bounds.top)}`;
    }
    case 'resize':
      return `${whole(box.width)} × ${whole(box.height)}`;
    case 'rotate':
      return `${round(normaliseAngle(box.rotation))}°`;
  }
}

/** Sub-pixel precision is noise at this size; the inspector is where it belongs. */
function whole(value: number): number {
  return Math.round(value);
}

/** Keeps the readout in 0–359 so a few turns of the handle stay readable. */
function normaliseAngle(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}
