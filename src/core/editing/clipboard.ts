/**
 * The element clipboard: ⌘C / ⌘X / ⌘V on whole objects.
 *
 * This was built once before and taken out again (docs/roadmap.md), and the
 * reason was never the keys — it was **where a paste lands**. The old one put
 * every paste under the slide root, which pulled the element out of the grid
 * cell or the `.container .card` that had been painting it, and it arrived
 * looking like something else. So the rule here is the one ⌘D already follows:
 *
 * 1. **beside the selection** — as its next sibling, in its parent, where the
 *    same CSS reaches it;
 * 2. **under the slide root** only when there is nothing to sit beside.
 *
 * Which of the two happens is the user's choice, made by what they have
 * selected when they press the key, rather than a guess made here.
 *
 * The clipboard lives outside any store, as the format painter's does
 * (format.ts): it survives selection changes and slide changes by design, and
 * nothing renders from it except whether the paste menu item is enabled.
 */

import { getActiveStage } from '../commands/engine';
import { useSelectionStore } from '../selection/store';
import {
  COPY_OFFSET,
  deleteSelection,
  insertMarkup,
  selectedObject,
  stripEditorMarks,
} from './actions';
import { t } from '../../shared/i18n';

interface ClipboardEntry {
  /** The element's markup, with everything the editor wrote already off it. */
  html: string;
  /**
   * Whether the element places itself rather than being placed by its parent.
   *
   * Only a self-positioned copy can land exactly on top of what it came from:
   * it carries its own coordinates, so a second one arrives at the same spot.
   * A grid cell, a flex item, a block in flow is given a place of its own by
   * the parent, and nudging one is not "clear of the original" but "16px out
   * of the cell it belongs in" — measured in a real browser, where the pasted
   * card sat a diagonal step below its own row.
   */
  selfPositioned: boolean;
  /**
   * What the next paste must not land exactly on top of: the element it was
   * copied from, and after that whatever the last paste put down.
   *
   * A uid only means anything in the stage that issued it, so this stops
   * resolving the moment another slide is loaded — which is the answer we
   * want. Pasting onto a different slide belongs at the position it was copied
   * from, and only a paste that would hide behind something needs nudging.
   */
  occupantUid: string | null;
  /** How far the next paste sits from the copied markup's own position. */
  offset: number;
}

let clipboard: ClipboardEntry | null = null;

export function hasClipboardElement(): boolean {
  return clipboard !== null;
}

/**
 * Takes a copy of the selected element's markup.
 *
 * Nothing about the document changes, so this is not a command and leaves no
 * step on the history — the same shape as the format painter's copy half.
 */
export function copySelection(): boolean {
  const bridge = getActiveStage();
  if (!bridge) return false;
  // A slide root is not an object; copying one would offer to paste the slide
  // into itself.
  const entry = selectedObject(bridge);
  if (!entry) return false;

  const clone = entry.element.cloneNode(true) as HTMLElement;
  stripEditorMarks(bridge, clone);
  // Asked here rather than at paste time, where all there is left is a string.
  const view = entry.element.ownerDocument.defaultView;
  const position = view ? view.getComputedStyle(entry.element).position : 'static';
  clipboard = {
    html: clone.outerHTML,
    selfPositioned: position === 'absolute' || position === 'fixed',
    occupantUid: entry.uid,
    offset: 0,
  };
  return true;
}

/** Copies, then removes — one step on the history, named for what was asked. */
export function cutSelection(): boolean {
  if (!copySelection()) return false;
  deleteSelection(t('command.cut'));
  return true;
}

export function pasteClipboard(): boolean {
  const bridge = getActiveStage();
  if (!bridge || !clipboard) return false;

  const anchor = selectedObject(bridge);
  // Nudged only when the copy would otherwise be invisible: it has to carry its
  // own position *and* have something still sitting at it. Each further paste
  // steps out again, so pasting three times gives three copies rather than a
  // stack of three. A cut leaves nothing behind, and a paste onto another slide
  // finds nothing there, so both land exactly where they were taken from.
  const occupied =
    clipboard.occupantUid !== null && bridge.resolve(clipboard.occupantUid) !== null;
  const offset = clipboard.selfPositioned && occupied ? clipboard.offset + COPY_OFFSET : 0;

  const command = insertMarkup(clipboard.html, {
    label: t('command.paste'),
    anchorUid: anchor?.uid ?? null,
    offset,
  });
  if (!command) return false;

  clipboard.offset = offset;
  // The paste selects what it created (`insertMarkup`), which is the element
  // the next one has to clear.
  clipboard.occupantUid = useSelectionStore.getState().uid;
  return true;
}

/** Test seam: the clipboard is module state, so it has to be resettable. */
export function clearClipboard(): void {
  clipboard = null;
}
