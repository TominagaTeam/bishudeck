/**
 * Putting a picture inside a box that was drawn to hold one.
 *
 * A deck exported from Claude marks its photo frames with `<image-slot>`, a
 * custom element whose own script takes a dropped file. Import cannot keep that
 * script: it is part of the template runtime that would re-render the deck
 * underneath the editor, so it goes, and the element is materialized as the
 * placeholder box it drew while empty — a dashed frame around the author's
 * caption (import/artifact.ts). Nothing is left that answers a drop, in the
 * editor or in an export. The component was
 * never going to work outside its own runtime either: it gates its controls on
 * `window.omelette.writeFile`, so a share link or a saved copy has always been
 * read-only.
 *
 * The reply is not to bring the component back. It is to give the editor an
 * operation of its own, and to keep that operation general: **put a picture
 * inside the selected box, whatever drew the box**. A photo frame is then
 * simply the box that most obviously wants one.
 *
 * General rather than frame-specific because the frame cannot be recognized
 * twice. Marking it during import would mean a `data-hse-*` attribute, and
 * serialization takes every one of those off (stage/bridge.ts) — the mark would
 * work until the first save and be missing from the file the user opens next.
 * Recognizing it by shape instead would tie this module to the exact markup
 * `materializeImageSlots` happens to write today. What survives a round trip is
 * the box itself, so the box is what the operation acts on.
 */

import { editorEvents } from '../events/bus';
import { getActiveStage } from '../commands/engine';
import type { EditCommand } from '../commands/types';
import { chooseImageAsset, importDroppedImage } from '../../shared/imagePicker';
import { t } from '../../shared/i18n';
import { isReplaced, isTextEditable } from '../../stage/selectionHeuristics';
import { selectedObject, withHtmlSnapshot } from './actions';
import { isCroppable } from './crop';

/**
 * How a picture sits in the box it was put into.
 *
 * The same declaration `materializeImageSlots` writes for a slot that arrived
 * already filled (import/artifact.ts), so a frame the deck's author filled and
 * one filled here are the same markup. `cover` rather than `contain` because
 * the box was drawn at the aspect ratio the layout wanted: fitting inside it
 * would show the frame's own backing around the photo.
 */
const PICTURE_STYLE = 'display:block;width:100%;height:100%;object-fit:cover';

/**
 * Whether a picture can be put into this element.
 *
 * Three refusals, each deferring to the test the rest of the editor already
 * uses for that question rather than forming a second opinion about it
 * (inspectorLayout.ts makes the same point about `isCroppable`):
 *
 * - **a picture already** — `isCroppable` is what トリミング is offered on, and
 *   replacing the photo in a frame is that panel's 「元の画像に戻す」 territory,
 *   not this one's.
 * - **something with words in it** — `isTextEditable` is what a double-click
 *   opens a session on. Filling one would throw away what the user typed, and
 *   an operation that deletes text should not be sitting under 画像.
 * - **an element that cannot hold children** — `<svg>`, `<video>` and the rest
 *   of {@link isReplaced}. They paint their own content and putting an `<img>`
 *   inside them shows nothing.
 *
 * Everything else is fair game, including a box that already holds other
 * elements. The label says the box will be filled, and the step undoes.
 */
export function isFillable(element: Element): boolean {
  return !isReplaced(element) && !isCroppable(element) && !isTextEditable(element);
}

/**
 * Puts a picture inside the selected box, replacing whatever it held.
 *
 * `src` is a reference the composed document can resolve — `assets/<name>` for
 * a file the user brought in through `importAsset`, which is what
 * `chooseImageAsset` (features/imagePicker.ts) hands back.
 */
export function fillWithImage(src: string): EditCommand | null {
  const bridge = getActiveStage();
  if (!bridge) return null;
  const entry = selectedObject(bridge);
  if (!entry || !isFillable(entry.element)) return null;

  // The caption a photo frame draws while empty is the author's description of
  // the picture that belongs there, which is what `alt` is for. Import already
  // does this for a slot that arrived carrying a `src` (artifact.ts).
  const alt = entry.element.textContent?.trim() ?? '';

  return withHtmlSnapshot(t('command.fillWithImage'), (stage) => {
    const picture = stage.document.createElement('img');
    picture.setAttribute('src', src);
    picture.setAttribute('alt', alt);
    picture.setAttribute('style', PICTURE_STYLE);
    entry.element.replaceChildren(picture);
  });
}

/**
 * The whole gesture: ask for a file, bring it in, put it in the selected box.
 *
 * Both doors into 画像を入れる call this — the inspector's panel and a
 * double-click on the box — so that "what happens when the dialog is
 * dismissed" and "what happens when the import fails" are answered once
 * instead of at each door.
 *
 * Not awaited by its callers: the dialog is modal to the OS, and the click
 * that opened it is over. Failures are reported through the event bus, which
 * is where the toast is already listening.
 */
export async function fillSelectionFromPicker(): Promise<void> {
  try {
    const src = await chooseImageAsset();
    if (!src) return;
    fillWithImage(src);
  } catch (cause) {
    editorEvents.emit('error', { message: t('error.insertImageFailed'), cause });
  }
}

/**
 * The same ending, entered from a drop instead of a dialog.
 *
 * Kept beside `fillSelectionFromPicker` rather than folded into it: the two
 * differ in where the file comes from and in nothing else, and a single
 * function taking "either a dialog or some paths" would say that badly. What
 * they share — the failure report, and doing nothing when there is no image —
 * is the part that matters, and it is the same here by being written the same
 * way.
 *
 * The caller selects the box first, the way the double-click does, so that the
 * box a picture landed in is the one left selected.
 */
export async function fillSelectionFromDrop(paths: readonly string[]): Promise<void> {
  try {
    const src = await importDroppedImage(paths);
    if (!src) return;
    fillWithImage(src);
  } catch (cause) {
    editorEvents.emit('error', { message: t('error.insertImageFailed'), cause });
  }
}
