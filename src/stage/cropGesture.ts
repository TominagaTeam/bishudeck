/**
 * The crop gesture: dragging the frame's edges, and sliding the picture behind
 * them.
 *
 * It mirrors {@link GestureController} — mutate the DOM as the pointer moves,
 * push one command on release — but acts on two elements at once, so both go
 * into the same snapshot and a crop undoes in a single step.
 *
 * Everything is computed in the frame's own axes. A rotated picture crops along
 * its own edges, which is the only reading of "take a strip off the top" that
 * makes sense once the object is at an angle, and it falls out of the same
 * `rotateVector` trick resizing uses.
 */

import { execute } from '../core/commands/engine';
import { StyleSnapshotCommand, captureStyles, type StyleSnapshot } from '../core/commands/snapshot';
import {
  MIN_CROP,
  applyCrop,
  frameBaseOf,
  readPlacement,
  type Crop,
  type CropTarget,
  type FrameBase,
  type Placement,
} from '../core/editing/crop';
import type { StageBridge } from './bridge';
import { rotateVector } from './geometry';
import { deadZoneFor, type Handle } from './interactions';
import { t } from '../shared/i18n';

/** Dragging the picture itself rather than one of the frame's edges. */
export const PICTURE_GRIP = 'picture';

export type CropGrip = Handle | typeof PICTURE_GRIP;

/** What a crop drag is measured from; exported so the maths can be tested. */
export interface CropStart {
  base: FrameBase;
  placement: Placement;
}

interface CropGestureState {
  grip: CropGrip;
  startX: number;
  startY: number;
  target: CropTarget;
  before: StyleSnapshot;
  base: FrameBase;
  placement: Placement;
  /** Stays false until the press clears `deadZone`; nothing is written before it does. */
  moved: boolean;
  /** The drag dead zone in the stage pixels this gesture works in. */
  deadZone: number;
}

export class CropController {
  #bridge: StageBridge;
  #onChange: () => void;
  #gesture: CropGestureState | null = null;

  constructor(bridge: StageBridge, onChange: () => void) {
    this.#bridge = bridge;
    this.#onChange = onChange;
  }

  get active(): boolean {
    return this.#gesture !== null;
  }

  begin(x: number, y: number, target: CropTarget, grip: CropGrip, scale = 1): void {
    const frame = this.#bridge.resolve(target.frameUid) as HTMLElement | null;
    const picture = this.#bridge.resolve(target.pictureUid) as HTMLElement | null;
    if (!frame || !picture) return;

    this.#gesture = {
      grip,
      startX: x,
      startY: y,
      target,
      before: captureStyles(this.#bridge, [target.frameUid, target.pictureUid]),
      base: frameBaseOf(frame),
      placement: readPlacement(picture),
      moved: false,
      // The zoom comes in from the caller for the same reason the other
      // gestures take it: the hand shakes by a physical distance, so the dead
      // zone is measured on screen and converted once, here.
      deadZone: deadZoneFor(scale),
    };
  }

  move(x: number, y: number): void {
    const gesture = this.#gesture;
    if (!gesture) return;
    if (!this.#armed(gesture, x, y)) return;

    const frame = this.#bridge.resolve(gesture.target.frameUid) as HTMLElement | null;
    const picture = this.#bridge.resolve(gesture.target.pictureUid) as HTMLElement | null;
    if (!frame || !picture) return;

    const local = rotateVector(
      x - gesture.startX,
      y - gesture.startY,
      -gesture.base.transform.rotation,
    );
    const next =
      gesture.grip === PICTURE_GRIP
        ? slidePicture(gesture, local)
        : trimEdges(gesture, gesture.grip, local);

    applyCrop(frame, picture, gesture.base, next);
    this.#onChange();
  }

  end(): void {
    const gesture = this.#gesture;
    this.#gesture = null;
    if (!gesture) return;
    // A grip pressed and released is a click, and a click may not crop:
    // `move()` wrote nothing, so there is nothing to record either
    // ([issues](../../docs/issues.md) #30).
    if (!gesture.moved) return;

    const after = captureStyles(this.#bridge, [
      gesture.target.frameUid,
      gesture.target.pictureUid,
    ]);
    execute(new StyleSnapshotCommand(t('command.crop'), gesture.before, after), {
      alreadyApplied: true,
    });
  }

  cancel(): void {
    const gesture = this.#gesture;
    this.#gesture = null;
    if (!gesture) return;

    for (const [uid, cssText] of gesture.before) {
      const element = this.#bridge.resolve(uid) as HTMLElement | null;
      if (!element) continue;
      if (cssText) element.style.cssText = cssText;
      else element.removeAttribute('style');
    }
    this.#onChange();
  }

  /**
   * Whether the press has travelled far enough to be a crop.
   *
   * The same rule the other gestures follow ({@link GestureController}): until
   * it clears the dead zone the gesture writes nothing at all, and once it has,
   * the flag stays up and every frame is still measured from the *start* point
   * — re-basing on the crossing point would leave the edge trailing the pointer
   * by the dead zone for the rest of the drag.
   */
  #armed(gesture: CropGestureState, x: number, y: number): boolean {
    if (gesture.moved) return true;
    if (Math.hypot(x - gesture.startX, y - gesture.startY) <= gesture.deadZone) return false;
    gesture.moved = true;
    return true;
  }
}

/**
 * Moves one or two of the frame's edges while the picture stays exactly where
 * it is on screen — which, since the picture is positioned *relative to the
 * frame*, means shifting it by however far the frame's corner travelled.
 *
 * The edge stops at the picture's own edge. PowerPoint clamps there too, and
 * the alternative is a frame with nothing in part of it, which reads as a bug
 * rather than as a choice.
 */
export function trimEdges(
  gesture: CropStart,
  handle: Handle,
  local: { x: number; y: number },
): Crop {
  const { base, placement } = gesture;

  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');

  // How far the frame's own top-left corner moves, and how far its far edges do.
  const offsetX = west ? clamp(local.x, placement.left, base.width - MIN_CROP) : 0;
  const offsetY = north ? clamp(local.y, placement.top, base.height - MIN_CROP) : 0;
  const farX = east
    ? clamp(local.x, MIN_CROP - base.width, placement.left + placement.width - base.width)
    : 0;
  const farY = south
    ? clamp(local.y, MIN_CROP - base.height, placement.top + placement.height - base.height)
    : 0;

  return {
    offsetX,
    offsetY,
    width: base.width - offsetX + farX,
    height: base.height - offsetY + farY,
    picture: { ...placement, left: placement.left - offsetX, top: placement.top - offsetY },
  };
}

/**
 * Slides the picture behind a frame that does not move. Held inside the frame:
 * a picture larger than its frame may not uncover an edge, and one smaller than
 * it may not be dragged out of it.
 */
export function slidePicture(gesture: CropStart, local: { x: number; y: number }): Crop {
  const { base, placement } = gesture;
  return {
    offsetX: 0,
    offsetY: 0,
    width: base.width,
    height: base.height,
    picture: {
      ...placement,
      left: between(placement.left + local.x, base.width - placement.width, 0),
      top: between(placement.top + local.y, base.height - placement.height, 0),
    },
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** Like {@link clamp}, but the two limits may arrive either way round. */
function between(value: number, a: number, b: number): number {
  return clamp(value, Math.min(a, b), Math.max(a, b));
}
