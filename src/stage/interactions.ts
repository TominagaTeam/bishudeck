/**
 * The gesture layer: move, resize and rotate.
 *
 * Gestures mutate the DOM as the pointer moves so the result is visible
 * immediately, and push a single command when the pointer is released. That
 * keeps one drag as one undo step without the command having to model the
 * gesture itself (see commands/snapshot.ts).
 *
 * Every gesture acts on exactly one element: the editor selects one element at
 * a time (core/selection/store.ts).
 */

import { SLIDE_ROOT_ATTRIBUTE } from '../core/document/compose';
import { execute } from '../core/commands/engine';
import {
  HtmlSnapshotCommand,
  StyleSnapshotCommand,
  captureStyles,
  type StyleSnapshot,
} from '../core/commands/snapshot';
import { cloneInPlace } from '../core/editing/actions';
import {
  pictureOf,
  readPlacement,
  scalePlacement,
  writePlacement,
  type Placement,
} from '../core/editing/crop';
import type { StageBridge } from './bridge';
import {
  boundsOf,
  boxOf,
  clampIntoView,
  readTransform,
  resizeKeepingAnchor,
  rotateVector,
  round,
  unionBounds,
  visibleBounds,
  writeTransform,
  type Bounds,
} from './geometry';
import type { GestureMeasure } from './measure';
import { shiftBounds, snapToGuides, type Guide, type SnapEdges } from './snapping';
import { t } from '../shared/i18n';

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface GestureCallbacks {
  onGuides(guides: Guide[]): void;
  /** Fired continuously so the overlay can follow the element. */
  onChange(): void;
  /** The live readout for the badge; null once the pointer is up. */
  onMeasure(measure: GestureMeasure | null): void;
}

/** Below this a correction is not worth a second layout pass. */
const SNAP_EPSILON = 0.01;

/** Stands in when the element has gone: no clipping rather than none allowed. */
const UNBOUNDED: Bounds = {
  left: Number.NEGATIVE_INFINITY,
  top: Number.NEGATIVE_INFINITY,
  right: Number.POSITIVE_INFINITY,
  bottom: Number.POSITIVE_INFINITY,
};

/** Smallest side a drag may leave, in stage pixels. */
const MIN_SIZE = 8;

/**
 * How far a press has to travel before it counts as a drag, in *screen* pixels.
 *
 * The hand that holds the mouse shakes by a physical distance, not by a number
 * of design pixels, so the dead zone is measured where the hand is. Gestures
 * work in stage pixels, which is why every `begin*` takes the stage's zoom:
 * only the value it had when the press landed matters, so passing it per
 * gesture keeps the controller free of a number that changes under it.
 */
const DRAG_DEAD_ZONE_PX = 4;

/**
 * {@link DRAG_DEAD_ZONE_PX} expressed in the stage pixels a gesture works in.
 *
 * Exported because the crop gesture (stage/cropGesture.ts) has the same problem
 * and must not grow a second threshold that drifts from this one.
 */
export function deadZoneFor(scale: number): number {
  return DRAG_DEAD_ZONE_PX / Math.max(scale, 0.01);
}

/**
 * What all three gestures carry: where the press landed, what an undo has to
 * put back, and whether the press has become a drag yet.
 */
interface GestureBase {
  startX: number;
  startY: number;
  uid: string;
  /** Taken before anything is written, so an undo can reach the untouched element. */
  before: StyleSnapshot;
  /** Stays false until the press clears `deadZone`; nothing is written before it does. */
  moved: boolean;
  /** `DRAG_DEAD_ZONE_PX` expressed in the stage pixels the gesture works in. */
  deadZone: number;
}

type Gesture =
  | (GestureBase & {
      kind: 'move';
      origin: { tx: number; ty: number };
      /** Slide markup as it was before the drag, taken only if Alt makes a copy. */
      markupBefore: string | null;
      cloned: boolean;
    })
  | (GestureBase & {
      kind: 'resize';
      handle: Handle;
      start: ResizeStart;
      picture: CroppedPicture | null;
      /** Whether the pre-drag size has been written yet; see `#resize`. */
      pinned: boolean;
    })
  | (GestureBase & {
      kind: 'rotate';
      cx: number;
      cy: number;
      startAngle: number;
      startRotation: number;
    });

/**
 * A cropped picture rides along with its frame when the frame is resized.
 *
 * The frame is the object; the picture is its content. Leaving the content at
 * a fixed size while the frame changes would mean a resize silently re-crops —
 * dragging a corner outwards would reveal more of the photo rather than making
 * the photo bigger. PowerPoint scales both, and so does this.
 */
interface CroppedPicture {
  uid: string;
  start: Placement;
}

interface ResizeStart {
  width: number;
  height: number;
  cx: number;
  cy: number;
  rotation: number;
  tx: number;
  ty: number;
  base: string;
}

/**
 * Which of the moving box's lines may attract while Shift holds it to an axis.
 *
 * The still axis offers none: a guide found there would nudge the element off
 * the line Shift is keeping it on, which is exactly what the lock is for. An
 * unlocked move offers all six, which is what `undefined` means to
 * `snapToGuides`.
 */
function lockedAxisEdges(axis: 'x' | 'y' | null): SnapEdges | undefined {
  if (axis === 'x') return { y: [] };
  if (axis === 'y') return { x: [] };
  return undefined;
}

/** Slide-relative bounds, used as the outermost snapping target. */
function slideBounds(bridge: StageBridge): Bounds {
  const roots = bridge.slideRoots();
  const all = roots.map((root) => (root as HTMLElement).getBoundingClientRect());
  const bounds = unionBounds(
    all.map((r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })),
  );
  return bounds ?? { left: 0, top: 0, right: 0, bottom: 0 };
}

export class GestureController {
  #bridge: StageBridge;
  #callbacks: GestureCallbacks;
  #gesture: Gesture | null = null;
  /**
   * Everything the gesture can align to, measured once at the start.
   *
   * Nothing else on the slide moves while a gesture runs, so re-reading every
   * other element's box on each pointer move only bought the same answer at the
   * price of a forced layout — which is what pays for the extra measurement
   * resizing now needs.
   */
  #targets: { others: Bounds[]; slide: Bounds; clip: Bounds } | null = null;

  constructor(bridge: StageBridge, callbacks: GestureCallbacks) {
    this.#bridge = bridge;
    this.#callbacks = callbacks;
  }

  get active(): boolean {
    return this.#gesture !== null;
  }

  /**
   * Whether the running gesture has cleared its dead zone — the difference
   * between a drag and a click, which only this class knows because only it
   * holds the threshold ({@link deadZoneFor}). Read before {@link end}, which
   * drops the gesture. False with none running.
   */
  get moved(): boolean {
    return this.#gesture?.moved ?? false;
  }

  beginMove(x: number, y: number, uid: string, scale = 1): void {
    this.#targets = null;
    const element = this.#bridge.resolve(uid) as HTMLElement | null;
    if (!element) return;
    const { tx, ty } = readTransform(element);
    this.#gesture = {
      kind: 'move',
      startX: x,
      startY: y,
      uid,
      before: captureStyles(this.#bridge, [uid]),
      origin: { tx, ty },
      moved: false,
      deadZone: deadZoneFor(scale),
      markupBefore: null,
      cloned: false,
    };
  }

  beginResize(x: number, y: number, uid: string, handle: Handle, scale = 1): void {
    this.#targets = null;
    const element = this.#bridge.resolve(uid) as HTMLElement | null;
    if (!element) return;
    const box = boxOf(element);
    const transform = readTransform(element);

    const framed = pictureOf(element);
    const pictureUid = framed ? this.#bridge.uidOf(framed) : null;
    const picture: CroppedPicture | null =
      framed && pictureUid ? { uid: pictureUid, start: readPlacement(framed) } : null;

    this.#gesture = {
      kind: 'resize',
      startX: x,
      startY: y,
      uid,
      handle,
      picture,
      moved: false,
      deadZone: deadZoneFor(scale),
      pinned: false,
      before: captureStyles(this.#bridge, picture ? [uid, picture.uid] : [uid]),
      start: {
        width: box.width,
        height: box.height,
        cx: box.cx,
        cy: box.cy,
        rotation: box.rotation,
        tx: transform.tx,
        ty: transform.ty,
        base: transform.base,
      },
    };
  }

  beginRotate(x: number, y: number, uid: string, scale = 1): void {
    this.#targets = null;
    const element = this.#bridge.resolve(uid) as HTMLElement | null;
    if (!element) return;
    const box = boxOf(element);
    this.#gesture = {
      kind: 'rotate',
      startX: x,
      startY: y,
      uid,
      before: captureStyles(this.#bridge, [uid]),
      moved: false,
      deadZone: deadZoneFor(scale),
      cx: box.cx,
      cy: box.cy,
      startAngle: angleOf(box.cx, box.cy, x, y),
      startRotation: box.rotation,
    };
  }

  /**
   * Shift arrives raw because it means something different to each gesture —
   * an axis lock while moving, the aspect ratio while resizing, 15° steps while
   * rotating. All three match PowerPoint; the move used to be the odd one out.
   */
  move(x: number, y: number, modifiers: { shift: boolean; alt: boolean }): void {
    const gesture = this.#gesture;
    if (!gesture) return;
    if (!this.#armed(gesture, x, y)) return;

    switch (gesture.kind) {
      case 'move':
        this.#moveSelection(gesture, x, y, modifiers.shift, modifiers.alt);
        break;
      case 'resize':
        this.#resize(gesture, x, y, modifiers.shift);
        break;
      case 'rotate':
        this.#rotate(gesture, x, y, modifiers.shift);
        break;
    }
    const element = this.#bridge.resolve(gesture.uid) as HTMLElement | null;
    this.#callbacks.onMeasure(element ? { kind: gesture.kind, box: boxOf(element) } : null);
    this.#callbacks.onChange();
  }

  end(): void {
    const gesture = this.#gesture;
    this.#gesture = null;
    this.#targets = null;
    this.#callbacks.onGuides([]);
    this.#callbacks.onMeasure(null);
    if (!gesture) return;

    // A copy left behind is a change in the slide's structure, which only a
    // markup snapshot can put back: a style snapshot restores attributes and
    // would leave the clone standing after an undo.
    if (gesture.kind === 'move' && gesture.cloned && gesture.markupBefore !== null) {
      execute(
        new HtmlSnapshotCommand(
          t('command.duplicateAndMove'),
          gesture.markupBefore,
          this.#bridge.slideMarkup(),
          gesture.uid,
        ),
        { alreadyApplied: true },
      );
      return;
    }

    // A press that never became a drag wrote nothing, so there is nothing to
    // record — whichever of the three it was.
    if (!gesture.moved) return;

    const touched =
      gesture.kind === 'resize' && gesture.picture
        ? [gesture.uid, gesture.picture.uid]
        : [gesture.uid];
    const after = captureStyles(this.#bridge, touched);
    const label =
      gesture.kind === 'move' ? t('command.move') : gesture.kind === 'resize' ? t('command.resize') : t('command.rotate');

    execute(new StyleSnapshotCommand(label, gesture.before, after), { alreadyApplied: true });
  }

  cancel(): void {
    const gesture = this.#gesture;
    this.#gesture = null;
    this.#targets = null;
    this.#callbacks.onGuides([]);
    this.#callbacks.onMeasure(null);
    if (!gesture) return;

    if (gesture.kind === 'move' && gesture.cloned && gesture.markupBefore !== null) {
      this.#bridge.replaceSlideContent(gesture.markupBefore);
      this.#callbacks.onChange();
      return;
    }

    for (const [uid, cssText] of gesture.before) {
      const element = this.#bridge.resolve(uid) as HTMLElement | null;
      if (!element) continue;
      if (cssText) element.style.cssText = cssText;
      else element.removeAttribute('style');
    }
    this.#callbacks.onChange();
  }

  /**
   * Whether the press has travelled far enough to be a drag.
   *
   * Until it has, the gesture writes nothing at all: a press that never clears
   * the dead zone was a click, and a click must leave the slide exactly as it
   * found it — no `transform`, no pinned size, no history entry.
   *
   * Once cleared the flag stays up and each gesture keeps measuring from its
   * *start* point, so the pointer and the element hold the grip they had.
   * Re-basing on the crossing point would leave the element trailing the
   * pointer by the dead zone for the rest of the drag.
   */
  #armed(gesture: Gesture, x: number, y: number): boolean {
    if (gesture.moved) return true;
    if (Math.hypot(x - gesture.startX, y - gesture.startY) <= gesture.deadZone) return false;
    gesture.moved = true;
    return true;
  }

  /**
   * Bounds of everything the element at `uid` can align to.
   *
   * Invalidated by `#invalidateTargets` when a gesture changes the slide under
   * itself, which so far only Alt-drag does.
   */
  #alignmentTargets(uid: string): { others: Bounds[]; slide: Bounds; clip: Bounds } {
    if (!this.#targets) {
      const others = this.#bridge
        .editableElements()
        .filter((el) => {
          const other = this.#bridge.uidOf(el);
          return other !== null && other !== uid;
        })
        .map((el) => boundsOf(boxOf(el as HTMLElement)));
      const element = this.#bridge.resolve(uid);
      this.#targets = {
        others,
        slide: slideBounds(this.#bridge),
        // Measured with everything else: what clips the element is its
        // ancestors, and a gesture moves the element rather than them.
        clip: element ? visibleBounds(element, SLIDE_ROOT_ATTRIBUTE) : UNBOUNDED,
      };
    }
    return this.#targets;
  }

  /* ------------------------------------------------------------------ move */

  #moveSelection(
    gesture: Extract<Gesture, { kind: 'move' }>,
    x: number,
    y: number,
    lockAxis: boolean,
    duplicate: boolean,
  ): void {
    const element = this.#bridge.resolve(gesture.uid) as HTMLElement | null;
    if (!element) return;

    let dx = x - gesture.startX;
    let dy = y - gesture.startY;

    // The drag is under way by the time this runs — the dead zone saw to that.
    // Alt held on a stationary pointer would otherwise stack a copy exactly on
    // top of the original.
    if (duplicate && !gesture.cloned) this.#leaveCopyBehind(gesture);

    // Shift holds the drag to one axis, as it does in PowerPoint. Which axis is
    // decided by the larger travel *from the press*, and decided again on every
    // move: a drag that turns a corner switches over without being released,
    // and letting go of Shift mid-drag hands the other axis straight back.
    const axis = lockAxis ? (Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y') : null;
    if (axis === 'x') dy = 0;
    if (axis === 'y') dx = 0;

    // The bounds still reflect the previous frame's position, so undo this
    // gesture's accumulated delta before asking where the drag wants to land.
    const current = this.#currentDelta(gesture);
    const unmoved = shiftBounds(boundsOf(boxOf(element)), -current.dx, -current.dy);
    const proposed = shiftBounds(unmoved, dx, dy);

    const targets = this.#alignmentTargets(gesture.uid);
    const snap = snapToGuides(proposed, targets.others, targets.slide, lockedAxisEdges(axis));
    dx += snap.dx;
    dy += snap.dy;

    // Last, after snapping, because this is the one rule a drag may not talk
    // its way out of: an element pushed all the way out of what clips it stops
    // being visible *and* stops answering the pointer, and the deck's own
    // `overflow` is not ours to switch off to get it back (invariant 2).
    // Stopping the drag at the edge is the only answer that changes nothing
    // about the deck.
    const kept = clampIntoView(unmoved, targets.clip, dx, dy);
    dx = kept.dx;
    dy = kept.dy;

    const transform = readTransform(element);
    writeTransform(element, {
      ...transform,
      tx: gesture.origin.tx + dx,
      ty: gesture.origin.ty + dy,
    });

    this.#callbacks.onGuides(snap.guides);
  }

  /**
   * Alt-drag: the copy is what stays behind, and the original keeps moving.
   *
   * Doing it the other way round — dragging the new node — would swap the uid
   * under the gesture, and with it the selection, the snapshot taken at the
   * start and the exclusion in the snapping targets. Keeping the original on
   * the pointer means none of that has to be rewritten mid-drag, and the result
   * on screen is the same one PowerPoint gives.
   */
  #leaveCopyBehind(gesture: Extract<Gesture, { kind: 'move' }>): void {
    const element = this.#bridge.resolve(gesture.uid) as HTMLElement | null;
    if (!element) return;

    // Rewinding to the start serves twice: the "before" markup has to show the
    // slide untouched, and the copy has to be left at the position the drag
    // began from — not wherever the pointer had already reached.
    const moved = readTransform(element);
    writeTransform(element, { ...moved, tx: gesture.origin.tx, ty: gesture.origin.ty });
    gesture.markupBefore = this.#bridge.slideMarkup();
    const clone = cloneInPlace(this.#bridge, gesture.uid);
    writeTransform(element, moved);
    if (!clone) return;

    // The copy needs a uid of its own, or undo and redo cannot find it again.
    this.#bridge.reindex();
    // It is also a new thing to align to.
    this.#targets = null;
    gesture.cloned = true;
  }

  #currentDelta(gesture: Extract<Gesture, { kind: 'move' }>): { dx: number; dy: number } {
    const element = this.#bridge.resolve(gesture.uid) as HTMLElement | null;
    if (!element) return { dx: 0, dy: 0 };
    const { tx, ty } = readTransform(element);
    return { dx: tx - gesture.origin.tx, dy: ty - gesture.origin.ty };
  }

  /* ---------------------------------------------------------------- resize */

  #resize(gesture: Extract<Gesture, { kind: 'resize' }>, x: number, y: number, lockAspect: boolean): void {
    const element = this.#bridge.resolve(gesture.uid) as HTMLElement | null;
    if (!element) return;
    const { start, handle } = gesture;

    // Pin the size that is about to change, so an element sized by its content
    // does not reflow out from under the drag. This used to run in
    // `beginResize`, *before* the "before" snapshot was taken — which meant an
    // undone resize put back the pinned state and left `width` / `height`
    // behind on an element that never had them. Writing it here
    // fixes that twice over: the snapshot is already taken, and a press that
    // never clears the dead zone never gets this far.
    if (!gesture.pinned) {
      element.style.width = `${round(start.width)}px`;
      element.style.height = `${round(start.height)}px`;
      gesture.pinned = true;
    }

    // Work in the element's own frame so resizing a rotated element still
    // follows its edges rather than the screen axes.
    const local = rotateVector(x - gesture.startX, y - gesture.startY, -start.rotation);

    const growX = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
    const growY = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;

    let width = Math.max(MIN_SIZE, start.width + local.x * growX);
    let height = Math.max(MIN_SIZE, start.height + local.y * growY);

    const keepRatio = lockAspect && growX !== 0 && growY !== 0;
    if (keepRatio) {
      const ratio = start.width / start.height;
      if (width / height > ratio) width = height * ratio;
      else height = width / ratio;
    }

    this.#applyResize(gesture, width, height, growX, growY);

    // A rotated box's edges no longer line up with the guides, and a locked
    // ratio would be broken by nudging one side, so neither snaps.
    if (start.rotation !== 0 || keepRatio) {
      this.#callbacks.onGuides([]);
      return;
    }

    // Snap the edge under the pointer, and only that edge: offering the other
    // three would let the far side find a guide and slide the box sideways
    // while it is supposedly being resized.
    //
    // Where that edge ended up is measured rather than predicted, for the same
    // reason `resizeKeepingAnchor` measures — how far a box moves when it grows
    // is up to the layout it sits in.
    const targets = this.#alignmentTargets(gesture.uid);
    const snap = snapToGuides(boundsOf(boxOf(element)), targets.others, targets.slide, {
      x: growX === 1 ? ['right'] : growX === -1 ? ['left'] : [],
      y: growY === 1 ? ['bottom'] : growY === -1 ? ['top'] : [],
    });

    if (Math.abs(snap.dx) > SNAP_EPSILON || Math.abs(snap.dy) > SNAP_EPSILON) {
      // growX/growY carry the sign: moving the west edge right *shrinks* the box.
      this.#applyResize(
        gesture,
        Math.max(MIN_SIZE, width + snap.dx * growX),
        Math.max(MIN_SIZE, height + snap.dy * growY),
        growX,
        growY,
      );
    }
    this.#callbacks.onGuides(snap.guides);
  }

  /** Writes one candidate size, anchoring whichever corner is not being dragged. */
  #applyResize(
    gesture: Extract<Gesture, { kind: 'resize' }>,
    width: number,
    height: number,
    growX: number,
    growY: number,
  ): void {
    const element = this.#bridge.resolve(gesture.uid) as HTMLElement | null;
    if (!element) return;
    const { start } = gesture;

    // Only a north or west drag moves the element's top-left corner; the other
    // two sides grow away from it. How far the element then moves *by itself*
    // is up to the layout it sits in, so `resizeKeepingAnchor` measures it.
    resizeKeepingAnchor(
      element,
      {
        width: start.width,
        height: start.height,
        cx: start.cx,
        cy: start.cy,
        transform: { base: start.base, tx: start.tx, ty: start.ty, rotation: start.rotation },
      },
      width,
      height,
      growX === -1 ? -(width - start.width) : 0,
      growY === -1 ? -(height - start.height) : 0,
    );

    if (gesture.picture) this.#scalePicture(gesture.picture, start, width, height);
  }

  /** Keeps a cropped picture in the same place *within* a frame that resized. */
  #scalePicture(picture: CroppedPicture, start: ResizeStart, width: number, height: number): void {
    const element = this.#bridge.resolve(picture.uid) as HTMLElement | null;
    if (!element || start.width === 0 || start.height === 0) return;

    writePlacement(element, scalePlacement(picture.start, width / start.width, height / start.height));
  }

  /* ---------------------------------------------------------------- rotate */

  #rotate(gesture: Extract<Gesture, { kind: 'rotate' }>, x: number, y: number, snap: boolean): void {
    const element = this.#bridge.resolve(gesture.uid) as HTMLElement | null;
    if (!element) return;

    const delta = angleOf(gesture.cx, gesture.cy, x, y) - gesture.startAngle;
    let rotation = gesture.startRotation + delta;
    if (snap) rotation = Math.round(rotation / 15) * 15;

    const transform = readTransform(element);
    writeTransform(element, { ...transform, rotation: round(rotation) });
  }
}

function angleOf(cx: number, cy: number, x: number, y: number): number {
  return (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
}
