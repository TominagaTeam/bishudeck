/**
 * Cropping a picture, the way a slide tool does it.
 *
 * PowerPoint's model is two rectangles: a *frame*, which is the object on the
 * slide, and the *picture*, which sits inside it at some size and offset. What
 * falls outside the frame is hidden but never discarded, so a crop can always
 * be loosened again. This module reproduces exactly that as plain HTML:
 *
 * ```html
 * <div style="position:absolute;left:…;top:…;width:…;height:…;overflow:hidden">
 *   <img src="…" style="position:absolute;left:…;top:…;width:…;height:…">
 * </div>
 * ```
 *
 * The frame is the element the user selects, moves and resizes; the picture's
 * `left`/`top` go negative for the parts that are cut away. Nothing here is
 * editor-specific — a deck author could have written it by hand, and any
 * browser renders it — which is what makes a crop survive export.
 *
 * `clip-path: inset(...)` would be fewer elements, and was the first thing
 * tried. It clips the paint but leaves the layout box the original size, so
 * `getBoundingClientRect` (and with it the selection frame, the snapping
 * targets and the alignment commands) keeps reporting the uncropped rectangle.
 * A crop you cannot select the edge of is not a crop.
 *
 * Wrapping is the one structural edit in the editor that happens to an element
 * the user did not ask to restructure, so it is deferred until cropping
 * actually begins, recorded as its own undo step, and never applied to a
 * picture that is already framed.
 */

import { create } from 'zustand';

import { execute, getActiveStage } from '../commands/engine';
import { StyleSnapshotCommand, captureStyles } from '../commands/snapshot';
import { useSelectionStore } from '../selection/store';
import {
  boxOf,
  readTransform,
  resizeKeepingAnchor,
  round,
  writeTransform,
  type EditorTransform,
} from '../../stage/geometry';
import { SLIDE_ROOT_ATTRIBUTE } from '../document/compose';
import { withHtmlSnapshot } from './actions';
import { t } from '../../shared/i18n';

/**
 * Marks the frame whose crop is being adjusted. The stage's own stylesheet
 * turns off its clipping while this is set, so the part being cut away stays
 * visible during the gesture; `serializeSlide` strips every `data-hse-*`, so it
 * cannot reach the saved file.
 */
export const CROPPING_ATTRIBUTE = 'data-hse-cropping';

/**
 * Holds an element's own `style` attribute from before opening a crop rewrote
 * it — on the picture always, and on a frame borrowed from the deck.
 *
 * Entering the two-rectangle model has to overwrite that attribute, and a
 * deck's `width: 100%` is exactly what gets lost. It is also the only reason a
 * picture follows the box it sits in, so 「元の画像に戻す」 cannot mean anything
 * without a copy of it.
 *
 * Not part of recognising a frame, which stays structural; this is only
 * ever read as a destination. `serializeSlide` strips every `data-hse-*`, so it
 * cannot reach the saved file, while `slideMarkup` keeps it — which is what
 * lets it survive undo.
 */
export const CROP_ORIGIN_ATTRIBUTE = 'data-hse-crop-origin';

/**
 * Marks a frame the editor created, as opposed to one it borrowed from the
 * deck. Only the former may be taken apart again on reset — the latter is the
 * author's element, and removing it would rewrite their slide.
 */
export const CROP_OWNED_ATTRIBUTE = 'data-hse-crop-owned';

/** Neither rectangle is allowed to collapse to nothing. */
export const MIN_CROP = 8;

/** `<img>` is the only thing worth cropping; the rest are drawn, not framed. */
const PICTURE_TAG = 'IMG';

/** Displays where a `<div>` wrapper would break the surrounding line box. */
const INLINE_DISPLAYS = new Set(['inline', 'inline-block', 'inline-flex']);

/** Declarations that belong to the picture inside the frame, never the frame. */
const PICTURE_ONLY = ['object-fit', 'object-position'];

export interface Placement {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CropTarget {
  frameUid: string;
  pictureUid: string;
}

/** The frame's geometry a crop is measured from. */
export interface FrameBase {
  width: number;
  height: number;
  cx: number;
  cy: number;
  transform: EditorTransform;
}

export interface Crop {
  /** Where the frame's top-left corner moves to, in the frame's own axes. */
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  /** The picture, in the coordinates of the frame this crop describes. */
  picture: Placement;
}

/* ---------------------------------------------------------------- session */

interface CropSession {
  target: CropTarget | null;
  /** Enters crop mode on the current selection, wrapping it if it is bare. */
  start(): void;
  stop(): void;
}

export const useCropSession = create<CropSession>((set, get) => ({
  target: null,

  start() {
    if (get().target) return;
    const target = openCrop();
    if (!target) return;
    markFrame(target.frameUid, true);
    set({ target });
  },

  stop() {
    const { target } = get();
    if (!target) return;
    markFrame(target.frameUid, false);
    set({ target: null });
  },
}));

/** Leaves crop mode whenever the selection moves off the frame being cropped. */
useSelectionStore.subscribe((state) => {
  const { target, stop } = useCropSession.getState();
  if (target && state.uid !== target.frameUid) stop();
});

function markFrame(frameUid: string, on: boolean): void {
  const element = getActiveStage()?.resolve(frameUid);
  if (!element) return;
  if (on) element.setAttribute(CROPPING_ATTRIBUTE, '');
  else element.removeAttribute(CROPPING_ATTRIBUTE);
}

/* ------------------------------------------------------------ recognition */

/**
 * The picture inside `element`, if `element` is a crop frame.
 *
 * Recognised by shape rather than by a mark of our own: a frame is a clipping
 * box holding one absolutely positioned picture and nothing else. A deck that
 * arrived already written that way is therefore croppable too, and a crop the
 * editor wrote is still recognised after a round trip through a file — which a
 * `data-hse-*` marker could not manage, since serialization strips them.
 */
export function pictureOf(element: Element): HTMLImageElement | null {
  if (element.tagName === PICTURE_TAG) return null;
  // The slide is the canvas, never an object on it, so it cannot be a picture's
  // frame however exactly it fits the shape. A generated deck clips its slide
  // (`overflow:hidden`) and a slide carrying one full-bleed photo matches the
  // rest of the test outright — at which point `frameOf` hands every click on
  // that photo the slide root, selection refuses the slide, and the picture
  // becomes unreachable: no selection, no crop, no response at all.
  if (element.hasAttribute(SLIDE_ROOT_ATTRIBUTE)) return null;
  const children = Array.from(element.children);
  if (children.length !== 1 || children[0].tagName !== PICTURE_TAG) return null;

  const view = element.ownerDocument.defaultView;
  if (!view) return null;
  // The stage turns a frame's clipping off while its crop is open (EditStage's
  // `[data-hse-cropping]` rule), and an author `!important` beats an inline
  // declaration — so asking the computed style mid-session denies a box that is
  // very much a frame, and the trimming panel vanishes out from under the user.
  if (!element.hasAttribute(CROPPING_ATTRIBUTE) && !clips(view.getComputedStyle(element))) {
    return null;
  }
  if (view.getComputedStyle(children[0]).position !== 'absolute') return null;
  return children[0] as HTMLImageElement;
}

/** Whether an element hides whatever its children paint outside its box. */
function clips(computed: CSSStyleDeclaration): boolean {
  return computed.overflow === 'hidden' || computed.overflow === 'clip';
}

/** Whether the trimming tool has anything to offer for this element. */
export function isCroppable(element: Element): boolean {
  return element.tagName === PICTURE_TAG || pictureOf(element) !== null;
}

/* -------------------------------------------------------------- placement */

export function readPlacement(picture: HTMLElement): Placement {
  const style = picture.style;
  return {
    // The inline values are what this module writes, so they are exact.
    // `offset*` is the fallback for a picture the deck itself placed, and is
    // integral in WebKit — good enough to start a gesture from, never used
    // once one is running.
    left: pixels(style.left) ?? picture.offsetLeft,
    top: pixels(style.top) ?? picture.offsetTop,
    width: pixels(style.width) ?? picture.offsetWidth,
    height: pixels(style.height) ?? picture.offsetHeight,
  };
}

export function writePlacement(picture: HTMLElement, placement: Placement): void {
  picture.style.left = `${round(placement.left)}px`;
  picture.style.top = `${round(placement.top)}px`;
  picture.style.width = `${round(placement.width)}px`;
  picture.style.height = `${round(placement.height)}px`;
}

/**
 * Where a placement lands once the frame around it has been scaled by
 * `kx`/`ky`.
 *
 * The picture is the frame's content, so it scales with the frame: a resize
 * that left the picture alone would silently be a re-crop, revealing more of
 * the photo rather than making the photo bigger. The axes are separate
 * because a frame can be stretched on one of them.
 */
export function scalePlacement(start: Placement, kx: number, ky: number): Placement {
  return {
    left: start.left * kx,
    top: start.top * ky,
    width: start.width * kx,
    height: start.height * ky,
  };
}

export function frameBaseOf(frame: HTMLElement): FrameBase {
  const box = boxOf(frame);
  return {
    width: box.width,
    height: box.height,
    cx: box.cx,
    cy: box.cy,
    transform: readTransform(frame),
  };
}

/**
 * Writes a crop out as CSS: the frame takes its new size and the picture its
 * new place inside it.
 *
 * The frame's corner travel (`offsetX`/`offsetY`) goes to
 * {@link resizeKeepingAnchor}, which measures how far the frame moved by itself
 * and corrects for it — the part a crop cannot get wrong, since the whole point
 * of dragging an edge in is that the picture behind it does *not* move.
 *
 * `base` is passed in rather than read here so a drag can apply every frame of
 * the gesture against the state it started from. Reading the DOM each time
 * would accumulate the rounding of every intermediate write.
 */
export function applyCrop(
  frame: HTMLElement,
  picture: HTMLElement,
  base: FrameBase,
  next: Crop,
): void {
  resizeKeepingAnchor(frame, base, next.width, next.height, next.offsetX, next.offsetY);
  writePlacement(picture, next.picture);
}

/* ------------------------------------------------------------- operations */

/** The ratios the trimming panel offers, as PowerPoint labels them. */
export const CROP_RATIOS = [
  { label: '1:1', ratio: 1 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '3:2', ratio: 3 / 2 },
] as const;

/** Runs `edit` against the live frame and records it as one undo step. */
function editCrop(label: string, target: CropTarget, edit: (state: LiveCrop) => Crop | null): void {
  const bridge = getActiveStage();
  if (!bridge) return;
  const frame = bridge.resolve(target.frameUid) as HTMLElement | null;
  const picture = bridge.resolve(target.pictureUid) as HTMLElement | null;
  if (!frame || !picture) return;

  const base = frameBaseOf(frame);
  const next = edit({ frame, picture, base, placement: readPlacement(picture) });
  if (!next) return;

  const before = captureStyles(bridge, [target.frameUid, target.pictureUid]);
  applyCrop(frame, picture, base, next);
  const after = captureStyles(bridge, [target.frameUid, target.pictureUid]);
  execute(new StyleSnapshotCommand(label, before, after), { alreadyApplied: true });
  bridge.commit();
}

interface LiveCrop {
  frame: HTMLElement;
  picture: HTMLElement;
  base: FrameBase;
  placement: Placement;
}

/**
 * Gives the whole picture back.
 *
 * A frame the editor put there is taken apart, so the picture returns to the
 * markup — and with it the sizing — it had before cropping began. That is the
 * only way a picture which was following its container (`width: 100%`, the
 * shape every imported deck uses) starts following it again, since wrapping had
 * to freeze it at pixels to have a rectangle to crop.
 *
 * A frame the deck wrote itself is left standing and merely opened out to the
 * whole picture. It is the author's element, holding the author's styling, and
 * dissolving it would rewrite their slide rather than undo our edit.
 */
export function resetCrop(target: CropTarget): void {
  if (restoreBeforeCrop(target)) return;
  editCrop(t('command.cropClear'), target, ({ placement }) => ({
    offsetX: placement.left,
    offsetY: placement.top,
    width: placement.width,
    height: placement.height,
    picture: { left: 0, top: 0, width: placement.width, height: placement.height },
  }));
}

/**
 * Crops to an aspect ratio around the frame's centre.
 *
 * The box grows to whatever the picture still has to give on the tighter side
 * rather than simply shrinking to fit the current frame: asking for 16:9 on a
 * frame that has plenty of picture above and below it should widen the view,
 * not throw away the sides.
 */
export function cropToRatio(target: CropTarget, ratio: number): void {
  editCrop(t('command.cropRatio', { ratio: ratioLabel(ratio) }), target, ({ base, placement }) => {
    const cx = base.width / 2;
    const cy = base.height / 2;
    const halfX = Math.min(cx - placement.left, placement.left + placement.width - cx);
    const halfY = Math.min(cy - placement.top, placement.top + placement.height - cy);
    if (halfX <= 0 || halfY <= 0) return null;

    const width = Math.max(MIN_CROP, Math.min(halfX * 2, halfY * 2 * ratio));
    const height = width / ratio;
    const offsetX = cx - width / 2;
    const offsetY = cy - height / 2;

    return {
      offsetX,
      offsetY,
      width,
      height,
      picture: { ...placement, left: placement.left - offsetX, top: placement.top - offsetY },
    };
  });
}

/**
 * Scales the picture so it covers the frame ("塗りつぶし"), or so the whole of
 * it fits inside ("はめ込み"). Both keep the picture's own proportions and its
 * centre; the frame does not move.
 */
export function scalePicture(target: CropTarget, mode: 'fill' | 'fit'): void {
  const label = mode === 'fill' ? t('command.cropFill') : t('command.cropFit');
  editCrop(label, target, ({ base, placement }) => {
    if (placement.height <= 0) return null;
    const ratio = placement.width / placement.height;
    const pick = mode === 'fill' ? Math.max : Math.min;
    const width = pick(base.width, base.height * ratio);
    const height = width / ratio;

    return {
      offsetX: 0,
      offsetY: 0,
      width: base.width,
      height: base.height,
      picture: {
        left: (base.width - width) / 2,
        top: (base.height - height) / 2,
        width,
        height,
      },
    };
  });
}

function ratioLabel(ratio: number): string {
  return CROP_RATIOS.find((entry) => Math.abs(entry.ratio - ratio) < 0.001)?.label ?? '';
}

/**
 * Puts both rectangles back the way they were before the crop was opened.
 * Answers whether it could: without a record of a "before" — a frame that
 * arrived already written in the two-rectangle model — the caller falls back to
 * widening the frame instead.
 *
 * A frame the editor created disappears; one borrowed from the deck merely gets
 * its own style back.
 */
function restoreBeforeCrop(target: CropTarget): boolean {
  const bridge = getActiveStage();
  const frame = bridge?.resolve(target.frameUid) as HTMLElement | null;
  const picture = bridge?.resolve(target.pictureUid) as HTMLElement | null;
  if (!bridge || !frame || !picture) return false;
  if (!frame.hasAttribute(CROP_ORIGIN_ATTRIBUTE) && !picture.hasAttribute(CROP_ORIGIN_ATTRIBUTE)) {
    return false;
  }

  const owned = isEditorFrame(frame);
  // Out of the session *before* the markup is captured. The session's mark is
  // taken off by whoever set it, so an undo that put one back into a document
  // with no session running would leave a frame that never clips again.
  useCropSession.getState().stop();

  withHtmlSnapshot(t('command.cropClear'), () => {
    restoreStyle(picture);
    if (owned) unframe(frame, picture);
    else restoreStyle(frame);
  });
  // The picture is the object on the slide again — and in the owned case the
  // element the selection pointed at is no longer in the document.
  useSelectionStore.getState().select(target.pictureUid);
  return true;
}

/**
 * Whether a frame is one the editor created, and so one it may take away again.
 * A frame borrowed from the deck is the author's element and stays.
 */
export function isEditorFrame(frame: Element): boolean {
  return frame.hasAttribute(CROP_OWNED_ATTRIBUTE);
}

/** Records an element's style so a reset can put it back, once and only once. */
function rememberStyle(element: Element): void {
  // A crop can be opened on the same picture again and again; the second time
  // round the current style is already the cropped one, and overwriting the
  // record with it would lose the only copy of the real "before".
  if (element.hasAttribute(CROP_ORIGIN_ATTRIBUTE)) return;
  element.setAttribute(CROP_ORIGIN_ATTRIBUTE, element.getAttribute('style') ?? '');
}

/**
 * Puts a remembered style back, keeping wherever the editor has since moved the
 * element: the sizing is what a crop changed, and where the object sits on the
 * slide is not part of it.
 */
function restoreStyle(element: HTMLElement): void {
  const origin = element.getAttribute(CROP_ORIGIN_ATTRIBUTE);
  if (origin === null) return;

  const moved = readTransform(element);
  // An empty record means the element had no style attribute at all, and giving
  // it an empty one back would be a difference the deck never asked for.
  if (origin) element.setAttribute('style', origin);
  else element.removeAttribute('style');
  element.removeAttribute(CROP_ORIGIN_ATTRIBUTE);

  writeTransform(element, {
    ...readTransform(element),
    tx: moved.tx,
    ty: moved.ty,
    rotation: moved.rotation,
  });
}

/**
 * Dissolves an editor-made frame, leaving the picture in its place. The frame
 * is what the editor has been moving, so its translation and rotation come off
 * with it and land on the picture. Kept free of the stage so it can be checked
 * without one — and free of layout, so jsdom can run it.
 */
export function unframe(frame: HTMLElement, picture: HTMLElement): void {
  const moved = readTransform(frame);
  writeTransform(picture, {
    ...readTransform(picture),
    tx: moved.tx,
    ty: moved.ty,
    rotation: moved.rotation,
  });
  frame.replaceWith(picture);
}

/* ---------------------------------------------------------------- opening */

/**
 * Resolves the selection to a frame and a picture, giving the picture a frame
 * on the way if it has not got one.
 *
 * Three ways in, and only the last one changes the slide's structure:
 *
 * 1. the frame itself is selected — already in the model, nothing to do;
 * 2. the picture is selected and the box it is already alone inside clips.
 *    That is a photo frame, whether the editor opened a crop here before or the
 *    deck was written that way, and it is *the* frame — adding another inside
 *    it would leave the first one standing at its old size around the trimmed
 *    picture, and a second double-click would add a third;
 * 3. neither — a bare picture, which gets a frame of its own.
 */
function openCrop(): CropTarget | null {
  const bridge = getActiveStage();
  const uid = useSelectionStore.getState().uid;
  const element = bridge && uid ? (bridge.resolve(uid) as HTMLElement | null) : null;
  if (!bridge || !uid || !element) return null;

  const framed = pictureOf(element);
  if (framed) {
    const pictureUid = bridge.uidOf(framed);
    return pictureUid ? { frameUid: uid, pictureUid } : null;
  }

  if (element.tagName !== PICTURE_TAG) return null;
  const picture = element as HTMLImageElement;
  const borrowed = borrowableFrame(picture);

  // Reopening a crop is not an edit. Only a picture that is not yet placed
  // inside a frame needs the slide restructured for it.
  let frame: HTMLElement | null = borrowed;
  if (!borrowed || !pictureOf(borrowed)) {
    withHtmlSnapshot(t('command.cropStart'), () => {
      frame = borrowed ? adopt(borrowed, picture) : wrap(picture);
    });
  }
  if (!frame) return null;

  const frameUid = bridge.uidOf(frame);
  if (!frameUid) return null;
  // The object on the slide is the frame now, so that is what stays selected.
  useSelectionStore.getState().select(frameUid);
  return { frameUid, pictureUid: uid };
}

/**
 * The box a picture is already alone inside, when that box clips — which is to
 * say, a photo frame, whoever wrote it.
 *
 * Reusing it is what keeps a crop from nesting. An imported deck draws its
 * pictures as `<div style="position:absolute;inset:0;overflow:hidden">` around
 * an `<img style="width:100%;height:100%">`; putting a second frame inside that
 * leaves the deck's own box — plate, ring and all — at the pre-crop size around
 * a trimmed picture, which is not a crop but a picture that shrank.
 *
 * Only when the box holds nothing else: taking the picture out of flow would
 * move whatever else was laid out beside it. And never a slide root — the slide
 * is the canvas, not an object on it (selectionHeuristics.ts).
 */
function borrowableFrame(picture: HTMLElement): HTMLElement | null {
  const frame = picture.parentElement;
  if (!frame || frame.tagName === 'BODY' || frame.hasAttribute(SLIDE_ROOT_ATTRIBUTE)) return null;
  if (frame.children.length !== 1 || frame.textContent?.trim()) return null;

  const computed = frame.ownerDocument.defaultView?.getComputedStyle(frame);
  return computed && clips(computed) ? frame : null;
}

/**
 * Moves a picture into the two-rectangle model inside the frame the deck
 * already drew for it, changing nothing about the frame itself.
 *
 * The picture keeps the rest of its own styling — a radius, a filter — because
 * unlike {@link wrap} there is no new element here to carry it; only the
 * declarations the model owns are overwritten.
 *
 * The frame is not tightened to the picture the way a bare one is. This
 * box is the author's, drawn at the size they chose, and it paints its own
 * plate in the letterbox bands.
 */
function adopt(frame: HTMLElement, picture: HTMLImageElement): HTMLElement {
  rememberStyle(frame);
  rememberStyle(picture);

  const computed = frame.ownerDocument.defaultView?.getComputedStyle(frame);
  // The picture inside is absolute, so the frame has to be its containing block
  // — and it has to become one *before* the picture is measured against it.
  if (computed?.position === 'static') frame.style.position = 'relative';

  placePicture(picture, placementInside(frame, picture));
  return frame;
}

/**
 * Where the picture's pixels land inside the frame it is being adopted into.
 *
 * Unlike {@link wrap}, the frame is not a copy of the picture's own box, so the
 * picture's place *within* it counts: one centred by `text-align` or pushed
 * over by padding would jump to the corner if this were read as `drawnRect`
 * alone. `offsetLeft`/`offsetTop` are the layout offsets from the frame's
 * padding edge — the same origin an absolute `left`/`top` resolves against —
 * and, being layout rather than paint, they ignore any transform in the way.
 */
function placementInside(frame: HTMLElement, picture: HTMLImageElement): Placement {
  const drawn = drawnRect(picture);
  const placed = picture.offsetParent === frame;
  return {
    left: (placed ? picture.offsetLeft : 0) + drawn.left,
    top: (placed ? picture.offsetTop : 0) + drawn.top,
    width: drawn.width,
    height: drawn.height,
  };
}

/**
 * Writes the picture's rectangle inside its frame. Once the rectangle is
 * explicit `object-fit` has no work left to do, so it is pinned to `fill` —
 * which, at the picture's own aspect ratio, paints identically.
 */
function placePicture(picture: HTMLElement, inside: Placement): void {
  picture.style.position = 'absolute';
  writePlacement(picture, inside);
  // Decks routinely cap images with `img { max-width: 100% }`, which would
  // squeeze a picture that is deliberately wider than its frame.
  picture.style.maxWidth = 'none';
  picture.style.maxHeight = 'none';
  picture.style.objectFit = 'fill';
  picture.style.display = 'block';
}

/**
 * Puts a clipping box around a picture that has none, without changing a single
 * pixel of what is on screen.
 *
 * The frame inherits the picture's own inline style, because that is where its
 * placement lives — position, offsets, transform, radius, shadow. What stays
 * behind is only the placement of the picture *within* the frame, and that is
 * rewritten from where the picture is actually being drawn right now: an
 * `object-fit: contain` picture is letterboxed inside its box, and reproducing
 * the letterbox as an explicit rectangle is what makes entering crop mode
 * invisible.
 */
function wrap(picture: HTMLImageElement): HTMLElement {
  const doc = picture.ownerDocument;
  const view = doc.defaultView;
  const computed = view?.getComputedStyle(picture);
  const rect = picture.getBoundingClientRect();
  const inside = drawnRect(picture);
  // Read before anything moves: `getComputedStyle` returns a live view, and
  // once the picture is inside a new parent it inherits from that instead.
  const bare = isBare(computed);

  const frame = doc.createElement('div');
  frame.setAttribute('style', picture.getAttribute('style') ?? '');
  for (const property of PICTURE_ONLY) frame.style.removeProperty(property);
  frame.style.width = `${round(rect.width)}px`;
  frame.style.height = `${round(rect.height)}px`;
  frame.style.overflow = 'hidden';
  // The picture inside is absolute, so the frame has to be its containing block.
  if (computed?.position === 'static') frame.style.position = 'relative';
  // A `<div>` where an inline picture was would break the line it sat on.
  if (computed && INLINE_DISPLAYS.has(computed.display)) frame.style.display = 'inline-block';

  picture.replaceWith(frame);
  frame.appendChild(picture);

  // The attribute about to be thrown away is the only record of how the deck
  // sized this picture, and resetCrop is the way back to it.
  rememberStyle(picture);
  frame.setAttribute(CROP_OWNED_ATTRIBUTE, '');
  picture.removeAttribute('style');
  placePicture(picture, inside);

  if (letterboxed(inside) && bare) tighten(frame, picture, inside);
  return frame;
}

/**
 * Pulls the frame in to the picture when the box it was in is bigger than the
 * pixels being drawn in it.
 *
 * `object-fit: contain` — what the editor's own 画像を挿入 writes — leaves
 * transparent bands at two edges, and the selection rectangle has always been
 * the box rather than the picture. Opening a crop on that would start from a
 * frame the picture does not fill, which reads as a bug ("why is my photo
 * smaller than its frame?") and is the opposite of where PowerPoint starts.
 *
 * Only when the bands really are empty. A picture with a background, a border
 * or a shadow paints in them, so tightening the frame would change the slide —
 * and entering crop mode is not allowed to change anything.
 */
function tighten(frame: HTMLElement, picture: HTMLElement, inside: Placement): void {
  applyCrop(frame, picture, frameBaseOf(frame), {
    offsetX: inside.left,
    offsetY: inside.top,
    width: inside.width,
    height: inside.height,
    picture: { left: 0, top: 0, width: inside.width, height: inside.height },
  });
}

/**
 * Whether the drawn picture leaves any of its box uncovered. Only the leading
 * edges need testing: `object-fit` never draws a picture smaller than its box
 * on one side without leaving the same gap on the other.
 */
function letterboxed(inside: Placement): boolean {
  return inside.left > 0.5 || inside.top > 0.5;
}

/** Nothing but the picture itself is painted in this element's box. */
function isBare(computed: CSSStyleDeclaration | undefined): boolean {
  if (!computed) return false;
  return (
    isTransparent(computed.backgroundColor) &&
    computed.backgroundImage === 'none' &&
    computed.borderTopWidth === '0px' &&
    computed.borderRightWidth === '0px' &&
    computed.borderBottomWidth === '0px' &&
    computed.borderLeftWidth === '0px' &&
    computed.boxShadow === 'none' &&
    computed.outlineStyle === 'none'
  );
}

function isTransparent(color: string): boolean {
  return color === 'transparent' || /^rgba\(.*,\s*0\s*\)$/.test(color);
}

/**
 * Where the picture's pixels actually land inside its own box, which is what
 * `object-fit` and `object-position` decide. Returned in the box's coordinates,
 * and allowed to stick out of it — `cover` does exactly that.
 */
export function drawnRect(picture: HTMLImageElement): Placement {
  const rect = picture.getBoundingClientRect();
  const view = picture.ownerDocument.defaultView;
  const computed = view?.getComputedStyle(picture);
  return fitRect(
    { width: rect.width, height: rect.height },
    { width: picture.naturalWidth, height: picture.naturalHeight },
    computed?.objectFit ?? 'fill',
    computed?.objectPosition ?? '50% 50%',
  );
}

export interface Size {
  width: number;
  height: number;
}

/**
 * The CSS `object-fit` / `object-position` calculation, as a rectangle in the
 * box's own coordinates. `cover` and `none` are allowed to come back larger
 * than the box, because that is exactly what they draw.
 *
 * Split out from the element so it can be checked against the spec's cases
 * without a layout engine: jsdom measures every box as zero.
 */
export function fitRect(box: Size, natural: Size, fit: string, position: string): Placement {
  // An SVG with no intrinsic size, or a picture that has not loaded, fills its
  // box by definition — there is no other ratio to honour.
  if (natural.width <= 0 || natural.height <= 0) return { left: 0, top: 0, ...box };

  const ratio = natural.width / natural.height;
  let width = box.width;
  let height = box.height;

  switch (fit) {
    case 'contain':
    case 'scale-down':
      width = Math.min(box.width, box.height * ratio);
      height = width / ratio;
      // `scale-down` is `contain` unless `none` would be smaller.
      if (fit === 'scale-down' && natural.width < width) {
        width = natural.width;
        height = natural.height;
      }
      break;
    case 'cover':
      width = Math.max(box.width, box.height * ratio);
      height = width / ratio;
      break;
    case 'none':
      width = natural.width;
      height = natural.height;
      break;
    default:
      break;
  }

  const [x, y] = alignment(position);
  return {
    left: offset(x, box.width - width),
    top: offset(y, box.height - height),
    width,
    height,
  };
}

/** `object-position` computes to two components; anything else is centred. */
function alignment(value: string): [string, string] {
  const parts = value.trim().split(/\s+/);
  return parts.length === 2 ? [parts[0], parts[1]] : ['50%', '50%'];
}

/**
 * A percentage aligns the picture within the slack, a length is the offset
 * itself — the same distinction CSS draws.
 */
function offset(component: string, slack: number): number {
  const value = Number.parseFloat(component);
  if (!Number.isFinite(value)) return slack / 2;
  return component.endsWith('%') ? (slack * value) / 100 : value;
}

function pixels(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return value.endsWith('px') && Number.isFinite(parsed) ? parsed : null;
}
