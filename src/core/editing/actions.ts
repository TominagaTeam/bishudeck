/**
 * The element-level operations a slide tool is expected to have: arrange,
 * order, duplicate, delete, nudge.
 *
 * Every one of them mutates the stage directly and then records a single
 * snapshot command, so they undo exactly and need no inverse logic of their own.
 *
 * They all act on the one selected element: the editor selects a single element
 * at a time (core/selection/store.ts).
 */

import { execute, getActiveStage } from '../commands/engine';
import {
  HtmlSnapshotCommand,
  StyleSnapshotCommand,
  captureStyles,
} from '../commands/snapshot';
import { useSelectionStore } from '../selection/store';
import {
  boundsOf,
  boxOf,
  readTransform,
  round,
  unionBounds,
  writeTransform,
  type Bounds,
} from '../../stage/geometry';
import type { EditCommand } from '../commands/types';
import type { StageBridge } from '../../stage/bridge';
import { UID_ATTRIBUTE } from '../../shared/ids';
import { t } from '../../shared/i18n';

/** Runs `mutate` and records whatever it did to this element's styles. */
function withStyleSnapshot(label: string, uid: string, mutate: (bridge: StageBridge) => void): void {
  const bridge = getActiveStage();
  if (!bridge) return;

  const before = captureStyles(bridge, [uid]);
  mutate(bridge);
  const after = captureStyles(bridge, [uid]);
  execute(new StyleSnapshotCommand(label, before, after), { alreadyApplied: true });
  bridge.commit();
}

/**
 * Runs `mutate` and records the slide's markup either side of it. Exported for
 * the other editing modules that restructure the slide (crop.ts wraps a picture
 * in a frame), so that every structural edit lands as one undo step recorded
 * the same way.
 */
export function withHtmlSnapshot(
  label: string,
  mutate: (bridge: StageBridge) => void,
): EditCommand | null {
  const bridge = getActiveStage();
  if (!bridge) return null;

  const before = bridge.slideMarkup();
  const selectionBefore = useSelectionStore.getState().uid;
  mutate(bridge);
  bridge.reindex();
  const after = bridge.slideMarkup();
  if (before === after) return null;

  const command = new HtmlSnapshotCommand(label, before, after, selectionBefore);
  execute(command, { alreadyApplied: true });
  bridge.commit();
  // Handed back so a caller that can still tell the edit was pointless — an
  // inserted text box nobody typed into — can revoke it rather than pile a
  // second step on top of it (core/commands/engine.ts).
  return command;
}

function selectedElement(bridge: StageBridge): { uid: string; element: HTMLElement } | null {
  const uid = useSelectionStore.getState().uid;
  if (!uid) return null;
  const element = bridge.resolve(uid) as HTMLElement | null;
  return element ? { uid, element } : null;
}

/** The selection, unless it is a slide root — those cannot be moved out or removed. */
export function selectedObject(bridge: StageBridge): { uid: string; element: HTMLElement } | null {
  const entry = selectedElement(bridge);
  if (!entry || bridge.slideRoots().includes(entry.element)) return null;
  return entry;
}

/* ------------------------------------------------------------------ nudge */

export function nudge(dx: number, dy: number): void {
  const bridge = getActiveStage();
  if (!bridge) return;
  const entry = selectedElement(bridge);
  if (!entry) return;

  withStyleSnapshot(t('command.move'), entry.uid, () => {
    const transform = readTransform(entry.element);
    writeTransform(entry.element, {
      ...transform,
      tx: round(transform.tx + dx),
      ty: round(transform.ty + dy),
    });
  });
}

/* -------------------------------------------------------------- alignment */

export type AlignEdge = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** Aligns the selected element to the slide — "centre this on the slide". */
export function align(edge: AlignEdge): void {
  const bridge = getActiveStage();
  if (!bridge) return;

  const entry = selectedElement(bridge);
  if (!entry) return;

  const bounds = boundsOf(boxOf(entry.element));
  const target = slideBounds(bridge);
  if (!target) return;

  withStyleSnapshot(t('command.align'), entry.uid, () => {
    const delta = alignDelta(edge, bounds, target);
    const transform = readTransform(entry.element);
    writeTransform(entry.element, {
      ...transform,
      tx: round(transform.tx + delta.dx),
      ty: round(transform.ty + delta.dy),
    });
  });
}

function alignDelta(edge: AlignEdge, bounds: Bounds, target: Bounds): { dx: number; dy: number } {
  switch (edge) {
    case 'left':
      return { dx: target.left - bounds.left, dy: 0 };
    case 'right':
      return { dx: target.right - bounds.right, dy: 0 };
    case 'center':
      return {
        dx: (target.left + target.right) / 2 - (bounds.left + bounds.right) / 2,
        dy: 0,
      };
    case 'top':
      return { dx: 0, dy: target.top - bounds.top };
    case 'bottom':
      return { dx: 0, dy: target.bottom - bounds.bottom };
    case 'middle':
      return {
        dx: 0,
        dy: (target.top + target.bottom) / 2 - (bounds.top + bounds.bottom) / 2,
      };
  }
}

function slideBounds(bridge: StageBridge): Bounds | null {
  const rects = bridge
    .slideRoots()
    .map((root) => (root as HTMLElement).getBoundingClientRect());
  return unionBounds(
    rects.map((r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })),
  );
}

/* ------------------------------------------------------------------ order */

export type OrderChange = 'front' | 'forward' | 'backward' | 'back';

/**
 * Reorders within the parent rather than assigning z-index, so stacking keeps
 * following the deck's own rules instead of being overridden by a magic number.
 */
export function reorder(change: OrderChange): void {
  withHtmlSnapshot(t('command.reorder'), (bridge) => {
    const entry = selectedElement(bridge);
    const parent = entry?.element.parentElement;
    if (!entry || !parent) return;

    switch (change) {
      case 'front':
        parent.appendChild(entry.element);
        break;
      case 'back':
        parent.insertBefore(entry.element, parent.firstChild);
        break;
      case 'forward': {
        const next = entry.element.nextElementSibling;
        if (next) parent.insertBefore(next, entry.element);
        break;
      }
      case 'backward': {
        const previous = entry.element.previousElementSibling;
        if (previous) parent.insertBefore(entry.element, previous);
        break;
      }
    }
  });
}

/* -------------------------------------------------------------- structure */

/**
 * Removes the selected element.
 *
 * The label is a parameter because a cut removes the element too, and the undo
 * button's tooltip is the label: saying 「要素を削除」 for a ⌘X would name the
 * half of the operation the user did not ask for (core/editing/clipboard.ts).
 */
export function deleteSelection(label: string = t('command.deleteElement')): void {
  const bridge = getActiveStage();
  if (!bridge) return;
  // Removing a slide root would leave nothing to edit.
  const entry = selectedObject(bridge);
  if (!entry) return;

  withHtmlSnapshot(label, () => entry.element.remove());
  useSelectionStore.getState().clear();
}

/**
 * How far a copy is nudged so that it does not hide the thing it came from.
 * Shared by ⌘D and by a paste that lands beside its own original.
 */
export const COPY_OFFSET = 16;

/**
 * Copies an element in place, as the next sibling of the original.
 *
 * No offset and no history of its own: the caller decides where the copy ends
 * up and how the whole thing is recorded. ⌘D nudges it clear of the original;
 * Alt-drag leaves the copy where it was and moves the original instead.
 *
 * The copy keeps the original's parent so the CSS that was painting it — a grid
 * cell, a `.container .card` descendant selector — still reaches it. Losing that
 * is what sank the earlier copy/paste (see roadmap).
 *
 * What the editor itself put on the original does not come along: neither its
 * address nor the scaffolding of any session running on it (`stripEditorMarks`).
 */
export function cloneInPlace(bridge: StageBridge, uid: string): Element | null {
  const element = bridge.resolve(uid) as HTMLElement | null;
  const parent = element?.parentElement;
  if (!element || !parent) return null;

  const clone = element.cloneNode(true) as HTMLElement;
  stripEditorMarks(bridge, clone);
  parent.insertBefore(clone, element.nextSibling);
  return clone;
}

export function duplicateSelection(): void {
  const bridge = getActiveStage();
  if (!bridge) return;
  const entry = selectedObject(bridge);
  if (!entry) return;

  const created: Element[] = [];
  withHtmlSnapshot(t('command.duplicateElement'), (stage) => {
    const clone = cloneInPlace(stage, entry.uid) as HTMLElement | null;
    if (!clone) return;
    // Offset so the copy is visibly a second thing rather than an exact overlap.
    offsetBy([clone], COPY_OFFSET);
    created.push(clone);
  });

  selectAfterInsert(bridge, created);
}

/* ----------------------------------------------------------------- insert */

/** Adds an element to the slide and leaves it selected, ready to be moved. */
export function insertElement(html: string, label = t('command.insertElement')): EditCommand | null {
  return insertMarkup(html, { label });
}

export interface InsertPlacement {
  /** The step's name in the history, and so the undo button's tooltip. */
  label?: string;
  /**
   * Put the markup in as this element's next sibling instead of under the slide
   * root. Same parent, so whatever CSS was reaching the anchor — a grid cell, a
   * `.container .card` descendant selector — reaches what goes in beside it.
   */
  anchorUid?: string | null;
  /** Nudge what goes in by this much on both axes, in slide pixels. */
  offset?: number;
}

/**
 * Puts markup into the slide and leaves it selected.
 *
 * Exported for the clipboard (clipboard.ts), which is the only caller that has
 * somewhere in particular for it to go; every other insert is
 * {@link insertElement}, which is this with no anchor and no offset.
 */
export function insertMarkup(html: string, placement: InsertPlacement = {}): EditCommand | null {
  const { label = t('command.insertElement'), anchorUid = null, offset = 0 } = placement;

  const bridge = getActiveStage();
  if (!bridge) return null;
  const anchor = anchorUid ? (bridge.resolve(anchorUid) as HTMLElement | null) : null;
  const parent = (anchor?.parentElement ?? bridge.slideRoots()[0]) as HTMLElement | undefined;
  if (!parent) return null;

  const created: Element[] = [];
  const command = withHtmlSnapshot(label, (stage) => {
    // Absolutely positioned inserts need a positioned ancestor to sit in — but
    // only the slide root is ours to make one of. A box inside the deck belongs
    // to its author, and giving it a containing block would move everything
    // else absolutely positioned in it (invariant 8).
    if (bridge.slideRoots().includes(parent)) {
      const view = parent.ownerDocument.defaultView;
      if (view && view.getComputedStyle(parent).position === 'static') {
        parent.style.position = 'relative';
      }
    }
    const template = stage.document.createElement('template');
    template.innerHTML = html;
    // Each element goes in after the one before it, so markup holding more than
    // one stays in the order it was written.
    let after: Node | null = anchor;
    for (const node of Array.from(template.content.children)) {
      if (after) parent.insertBefore(node, after.nextSibling);
      else parent.appendChild(node);
      after = node;
      created.push(node);
    }
    if (offset !== 0) offsetBy(created, offset);
  });

  selectAfterInsert(bridge, created);
  return command;
}

function offsetBy(elements: Element[], distance: number): void {
  for (const element of elements) {
    const transform = readTransform(element as HTMLElement);
    writeTransform(element as HTMLElement, {
      ...transform,
      tx: round(transform.tx + distance),
      ty: round(transform.ty + distance),
    });
  }
}

/** Leaves the first of the inserted elements selected; only one can be. */
function selectAfterInsert(bridge: StageBridge, created: Element[]): void {
  for (const element of created) {
    const uid = bridge.uidOf(element);
    if (uid) {
      useSelectionStore.getState().select(uid);
      return;
    }
  }
}

/**
 * Everything the editor wrote onto an element, off a copy of it.
 *
 * It was `stripUids`, and the name was the whole of the bug: it said what it
 * removed rather than why, so nothing about it suggested that the *other*
 * things the editor writes had to go as well. A copy of a text box that was
 * still carrying `data-hse-blank` painted 「テキストを入力」 over itself
 * forever — no session on it to take the mark off, and not the box the stage is
 * holding a place for either, so it could not even be typed into.
 *
 * The two halves part company at the address, and only here:
 *
 * - **the address goes.** A copy that answers to the original's uid is a second
 *   element at the same address, and `resolve` hands out whichever it finds
 *   first. The next `reindex()` issues a fresh one, so the copy has an identity
 *   of its own from the moment it is indexed.
 * - **the scaffolding goes too**, and that half is shared with the undo
 *   snapshot, which keeps the address (`StageBridge.stripScaffolding`).
 *
 * Exported because copying to the clipboard is the third door markup is carried
 * through (clipboard.ts), and a second list of what to take off is exactly what
 * this one is here to prevent.
 */
export function stripEditorMarks(bridge: StageBridge, element: Element): void {
  bridge.stripScaffolding(element);
  element.removeAttribute(UID_ATTRIBUTE);
  element.querySelectorAll(`[${UID_ATTRIBUTE}]`).forEach((child) => {
    child.removeAttribute(UID_ATTRIBUTE);
  });
}
