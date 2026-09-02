/**
 * Position and size as numbers someone types, rather than a corner they drag.
 *
 * The counterpart to the resize and move gestures (stage/interactions.ts): the
 * same writes, expressed the same way — an editor `translate()` on top of
 * whatever transform the deck wrote, and `width` / `height` as inline
 * overrides — but driven from the inspector's fields. It sits in
 * `core/editing` rather than in the panel because it touches the stage and the
 * history, which a UI file may not, and because the folding and the undo below
 * are what needed testing.
 *
 * `stage/geometry.ts` is the other half and reads: it derives the oriented box
 * this module writes back to.
 *
 * **Each call is a whole edit, measured fresh.** The fields apply on every
 * keystroke, so by the time the next one arrives the element has already moved;
 * a baseline captured when the typing started would make the second keystroke
 * move it twice as far. Measuring here also means the caller needs no session
 * of its own — the write lands while the field still holds focus, so it cannot
 * arrive at a box the user has already clicked away to.
 */

import { execute, getActiveStage } from '../commands/engine';
import { StyleSnapshotCommand, captureStyles } from '../commands/snapshot';
import { pictureOf, readPlacement, scalePlacement, writePlacement } from './crop';
import { boxOf, readTransform, writeTransform } from '../../stage/geometry';
import { t } from '../../shared/i18n';

export type GeometryField = 'x' | 'y' | 'width' | 'height' | 'rotation';

/** A box with no extent has no edge left to grab, so nothing may write zero. */
export const MIN_SIZE = 1;

/**
 * Puts one of the five numbers on the element, and records it as an edit that
 * folds into the run it belongs to.
 *
 * The key carries the field as well as the element: X, Y and 回転 all write the
 * same `transform` property, so a set of snapshots cannot tell them apart the
 * way `SetInlineStyleCommand` tells its properties apart. Moving to another
 * field therefore ends the run, which is the same rule — one adjustment, one
 * undo step.
 */
export function setGeometry(uid: string, field: GeometryField, value: number): void {
  const stage = getActiveStage();
  const element = stage?.resolve(uid) as HTMLElement | null;
  if (!stage || !element || !Number.isFinite(value)) return;

  // A cropped picture is its frame's content and scales with it, here exactly
  // as it does under a resize handle — otherwise typing a width would
  // silently re-crop the photo instead of resizing it. Read before the write:
  // both elements go into one snapshot, so it is one undo step.
  const framed = pictureOf(element);
  const pictureUid = framed ? stage.uidOf(framed) : null;
  const placement = framed ? readPlacement(framed) : null;

  const touched = pictureUid ? [uid, pictureUid] : [uid];
  const before = captureStyles(stage, touched);

  const box = boxOf(element);
  const transform = readTransform(element);

  if (field === 'x') {
    writeTransform(element, { ...transform, tx: transform.tx + (value - (box.cx - box.width / 2)) });
  } else if (field === 'y') {
    writeTransform(element, { ...transform, ty: transform.ty + (value - (box.cy - box.height / 2)) });
  } else if (field === 'rotation') {
    writeTransform(element, { ...transform, rotation: value });
  } else {
    const next = Math.max(MIN_SIZE, value);
    const was = field === 'width' ? box.width : box.height;
    element.style[field] = `${next}px`;
    if (framed && placement && was > 0) {
      const k = next / was;
      // Only the axis the field owns; the other one is not being changed.
      writePlacement(
        framed,
        field === 'width' ? scalePlacement(placement, k, 1) : scalePlacement(placement, 1, k),
      );
    }
  }

  const after = captureStyles(stage, touched);
  execute(
    new StyleSnapshotCommand(t('command.setGeometry'), before, after, `geometry:${field}:${uid}`),
    { alreadyApplied: true },
  );
  stage.commit();
}
