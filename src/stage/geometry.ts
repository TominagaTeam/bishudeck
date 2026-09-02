/**
 * The geometry of an element as a slide tool thinks of it: a box with a centre,
 * a size and a rotation.
 *
 * HTML has no such model, so it is derived. The trick that makes it cheap is
 * that rotation and translation both leave the *centre* of an element's
 * axis-aligned bounding box where the untransformed centre would be, as long as
 * `transform-origin` is the default centre. So the centre comes from
 * `getBoundingClientRect`, the size from the untransformed layout box, and the
 * angle from the transform the editor itself wrote.
 */

export interface OrientedBox {
  cx: number;
  cy: number;
  width: number;
  height: number;
  /** Degrees, clockwise. */
  rotation: number;
}

export interface EditorTransform {
  /** Whatever transform the deck itself applied, preserved verbatim. */
  base: string;
  tx: number;
  ty: number;
  rotation: number;
}

/** Matches exactly the form {@link writeTransform} emits. */
const EDITOR_TRANSFORM =
  /^(.*?)\s*translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*rotate\((-?[\d.]+)deg\)$/;

export function readTransform(element: HTMLElement): EditorTransform {
  const inline = element.style.transform.trim();
  const match = inline.match(EDITOR_TRANSFORM);
  if (match) {
    return {
      base: match[1].trim(),
      tx: Number(match[2]),
      ty: Number(match[3]),
      rotation: Number(match[4]),
    };
  }

  // Nothing the editor wrote. Anything already inline is the deck's own and is
  // kept as the base so moving an element never discards its authored transform.
  return { base: inline, tx: 0, ty: 0, rotation: 0 };
}

export function writeTransform(element: HTMLElement, next: EditorTransform): void {
  const { base, tx, ty, rotation } = next;
  if (tx === 0 && ty === 0 && rotation === 0) {
    if (base) element.style.transform = base;
    else element.style.removeProperty('transform');
    return;
  }
  const parts = [base, `translate(${round(tx)}px, ${round(ty)}px)`, `rotate(${round(rotation)}deg)`];
  element.style.transform = parts.filter(Boolean).join(' ');
}

export function boxOf(element: HTMLElement): OrientedBox {
  const rect = element.getBoundingClientRect();
  const { rotation } = readTransform(element);
  const size = layoutSizeOf(element, rect);
  return {
    cx: rect.left + rect.width / 2,
    cy: rect.top + rect.height / 2,
    // The layout box, which rotation does not change.
    width: size.width,
    height: size.height,
    rotation,
  };
}

/**
 * The element's untransformed size.
 *
 * `offsetWidth`/`offsetHeight` live on `HTMLElement` and nowhere else, so the
 * inserted `line` and `arrow` shapes — which are `<svg>` roots — have neither.
 * Falling back to the bounding rect for those returned the *rotated* bounds,
 * and since the inspector reads the box and writes `style.width`, retyping the
 * width it was showing shrank the shape a little more each time: a 360px arrow
 * at 45° read 260, and writing 260 back made it read 190.
 *
 * Computed style is the right source for those: it reports the used width in
 * px, transforms do not touch it, and it is the same property
 * `resizeKeepingAnchor` and the inspector write — so reading and writing agree.
 * The test is `in` rather than a typeof check because jsdom gives every
 * HTMLElement an `offsetWidth` of 0, which would send the HTML path here too.
 */
function layoutSizeOf(element: HTMLElement, rect: DOMRect): { width: number; height: number } {
  if ('offsetWidth' in element) {
    return { width: element.offsetWidth || rect.width, height: element.offsetHeight || rect.height };
  }
  const style = getComputedStyle(element);
  return {
    width: parseFloat(style.width) || rect.width,
    height: parseFloat(style.height) || rect.height,
  };
}

export interface ResizeAnchor {
  /** The element's size and centre before the gesture, and its transform then. */
  width: number;
  height: number;
  cx: number;
  cy: number;
  transform: EditorTransform;
}

/**
 * Gives an element a new size while keeping a chosen corner of it still.
 *
 * `moveX`/`moveY` are how far the element's top-left corner should travel in
 * the element's own axes: zero when the drag is on the south or east side,
 * minus the growth when it is on the north or west.
 *
 * The correction is *measured* rather than predicted, because how much an
 * element moves by itself when it changes size is a property of the layout
 * around it, not of the element. A box pinned by `left`/`top` grows away from
 * its top-left and its centre slides by half; one centred in a flex row does
 * not move its centre at all; one in normal flow does one of those per axis.
 * Predicting it means guessing, and guessing wrong slides the element out from
 * under the pointer by half the drag — which is what this used to do to
 * anything absolutely positioned.
 *
 * So: write the size, put the transform back to where the gesture started, ask
 * the element where that left it, and translate by the difference. Costs one
 * forced layout per pointer move, which a drag is already paying several times.
 */
export function resizeKeepingAnchor(
  element: HTMLElement,
  start: ResizeAnchor,
  width: number,
  height: number,
  moveX: number,
  moveY: number,
): void {
  const wanted = rotateVector(
    moveX + (width - start.width) / 2,
    moveY + (height - start.height) / 2,
    start.transform.rotation,
  );

  element.style.width = `${round(width)}px`;
  element.style.height = `${round(height)}px`;
  writeTransform(element, start.transform);

  const settled = boxOf(element);
  writeTransform(element, {
    ...start.transform,
    tx: round(start.transform.tx + start.cx + wanted.x - settled.cx),
    ty: round(start.transform.ty + start.cy + wanted.y - settled.cy),
  });
}

/** Axis-aligned bounds of an oriented box, which is what snapping works on. */
export function boundsOf(box: OrientedBox): Bounds {
  if (box.rotation === 0) {
    return {
      left: box.cx - box.width / 2,
      top: box.cy - box.height / 2,
      right: box.cx + box.width / 2,
      bottom: box.cy + box.height / 2,
    };
  }
  const rad = (box.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const halfW = (box.width * cos + box.height * sin) / 2;
  const halfH = (box.width * sin + box.height * cos) / 2;
  return {
    left: box.cx - halfW,
    top: box.cy - halfH,
    right: box.cx + halfW,
    bottom: box.cy + halfH,
  };
}

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function unionBounds(all: Bounds[]): Bounds | null {
  if (all.length === 0) return null;
  return all.reduce((acc, b) => ({
    left: Math.min(acc.left, b.left),
    top: Math.min(acc.top, b.top),
    right: Math.max(acc.right, b.right),
    bottom: Math.max(acc.bottom, b.bottom),
  }));
}

/** Rotates a vector by `degrees`, for working in an element's own frame. */
export function rotateVector(x: number, y: number, degrees: number): { x: number; y: number } {
  if (degrees === 0) return { x, y };
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

export function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * How much of an element a drag has to leave where it can be seen, in stage
 * pixels. Enough to see it and enough to take hold of it — those are the same
 * requirement, because the way back to an object is to point at it.
 */
export const MIN_VISIBLE = 24;

/**
 * The region an element can actually be seen in: the slide, narrowed by every
 * ancestor between the two that clips what overflows it.
 *
 * Dragging is what makes this matter. `overflow:hidden` takes an element out of
 * *hit testing* as well as out of the picture, so a box dragged past the edge of
 * the card it lives in — or past the edge of the slide, which the stage clips
 * the same way — stops being anywhere at all: invisible, and unreachable by the
 * pointer that put it there.
 *
 * Two approximations, both deliberately on the side of *not* getting in the way
 * (there are other ways back to a lost element — Alt+click, the context menu's
 * list, the selection frame's own edge — so a clipper missed here is recoverable,
 * while one invented here would refuse a drag that should have been allowed):
 *
 * - **the border box, not the padding box.** Clipping happens inside the border,
 *   so this lets an element hide under a border — a few pixels, and only ever
 *   in the permissive direction
 * - **the containing-block chain, walked roughly.** `overflow` clips a
 *   descendant only when the clipper is in that descendant's containing-block
 *   chain, so an absolutely positioned box is not clipped by a `static`
 *   ancestor. That is tracked here rather than fully modelled: what CSS calls a
 *   containing block also answers to `contain`, `filter` and `will-change`,
 *   which decks do not use to lay out with.
 */
export function visibleBounds(element: Element, slideRootAttribute: string): Bounds {
  const view = element.ownerDocument.defaultView;
  let bounds: Bounds = {
    left: Number.NEGATIVE_INFINITY,
    top: Number.NEGATIVE_INFINITY,
    right: Number.POSITIVE_INFINITY,
    bottom: Number.POSITIVE_INFINITY,
  };
  if (!view) return bounds;

  // Whether the element is currently out of reach of a `static` clipper,
  // because its containing block is further up than the next ancestor.
  let escaping = isPositionedOut(view.getComputedStyle(element).position);

  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = view.getComputedStyle(parent);
    const positioned = style.position !== 'static';

    if (!escaping || positioned) {
      const box = parent.getBoundingClientRect();
      if (clipsAxis(style.overflowX, style.overflow)) {
        bounds = { ...bounds, left: Math.max(bounds.left, box.left), right: Math.min(bounds.right, box.right) };
      }
      if (clipsAxis(style.overflowY, style.overflow)) {
        bounds = { ...bounds, top: Math.max(bounds.top, box.top), bottom: Math.min(bounds.bottom, box.bottom) };
      }
    }

    if (positioned) escaping = false;
    if (isPositionedOut(style.position)) escaping = true;
    if (parent.hasAttribute(slideRootAttribute)) break;
  }

  return bounds;
}

function isPositionedOut(position: string): boolean {
  return position === 'absolute' || position === 'fixed';
}

/**
 * Whether one axis is clipped, reading the longhand first and the shorthand
 * only when it can speak for both axes.
 *
 * Every real engine resolves `overflow: hidden` into both longhands, so the
 * second half never runs in the app. jsdom does not — it answers
 * `overflowX: "visible"` for an element whose style says `overflow: hidden` —
 * and the unit tests are worth writing against the declaration a deck actually
 * carries. A shorthand with a space in it names the two axes separately and
 * cannot stand in for either, so it is left alone.
 */
function clipsAxis(longhand: string, shorthand: string): boolean {
  if (longhand !== 'visible' && longhand !== '') return true;
  if (shorthand.includes(' ')) return false;
  return shorthand !== 'visible' && shorthand !== '';
}

/**
 * The move that keeps `MIN_VISIBLE` of the box inside `clip`, given the move the
 * drag asked for.
 *
 * Only ever pulls the drag back, never pushes it on, and gives up on an axis it
 * cannot satisfy — a box wider than the region it is clipped to has no offset
 * that leaves a margin on both sides, and refusing to move it at all would be
 * worse than letting it be where the pointer says.
 */
export function clampIntoView(box: Bounds, clip: Bounds, dx: number, dy: number): { dx: number; dy: number } {
  return {
    dx: clampAxis(box.left, box.right, clip.left, clip.right, dx),
    dy: clampAxis(box.top, box.bottom, clip.top, clip.bottom, dy),
  };
}

function clampAxis(start: number, end: number, min: number, max: number, delta: number): number {
  if (!Number.isFinite(min) && !Number.isFinite(max)) return delta;
  const lowest = min - end + MIN_VISIBLE;
  const highest = max - start - MIN_VISIBLE;
  if (lowest > highest) return delta;
  return Math.min(Math.max(delta, lowest), highest);
}

