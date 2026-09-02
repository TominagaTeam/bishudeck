/**
 * Inserting a text box, and the rule that an unused one leaves nothing behind.
 *
 * A new box is inserted empty (shapes.ts), which means it is invisible until
 * something is in it. Two things follow from that, and both live here:
 *
 * - it lands *selected*, not open for typing, so the handles are what tell the
 *   user where it is and the first thing they can do with it is move it;
 * - if it is still empty when it is let go of, the insertion is taken back.
 *   "Let go of" has no single moment, which is the awkward part: the selection
 *   moving away, the slide changing, a session on it ending, and the deck's
 *   shape being about to change all count, and each of them is a different
 *   caller here.
 *
 * The alternative — inserting the box holding 「テキストを入力」 as real text —
 * put a word the editor chose into the user's document, and it stayed there
 * unless they noticed and deleted it.
 *
 * Opening the session on insertion was tried before this and was the thing
 * users tripped over: a box that is already in text mode cannot be dragged
 * (the interaction layer steps aside for the whole session), so the box always
 * landed in the wrong place and stayed there. Selecting instead means the
 * stage has to be able to enter an empty box afterwards, which is what
 * `isUntouchedTextBox` is for, and it means the record below outlives the
 * insertion — see `dropTextBox` for who ends it now.
 */

import { getActiveStage, revoke } from '../commands/engine';
import type { EditCommand } from '../commands/types';
import { useSelectionStore } from '../selection/store';
import { t } from '../../shared/i18n';
import { insertElement, withHtmlSnapshot } from './actions';
import { textBoxHtml, type Placement } from './shapes';

/**
 * Things that are content without being text. An element holding one of these
 * is not empty however little it has to say, so it is never dropped as unused
 * and never mistaken for a box waiting to be typed into.
 */
const NON_TEXT_CONTENT = 'img, picture, svg, canvas, video, audio, iframe, object, embed, input, hr, table';

/**
 * The box just inserted, until it is either typed into or dropped.
 *
 * A uid rather than the element (invariant 6), and it only ever describes the
 * insertion that has just happened: a box that stays is forgotten as soon as it
 * has text, so no later edit of it can be mistaken for the one that created it.
 *
 * It used to be cleared by whichever text session ended next, which worked only
 * because the insertion opened one. Nothing opens a session now, so the stage
 * ends the record instead — when the selection leaves the box, or when the
 * slide it lives on is about to be swapped out (stage/EditStage.tsx) — and
 * anything that is about to read or copy a slide's markup asks for it to be
 * ended here, through `settlePendingTextBox`.
 */
let pending: { uid: string; command: EditCommand } | null = null;

/**
 * Adds an empty text box and leaves it selected.
 *
 * No text session: `insertElement` selects what it created, and a selected box
 * is one the user can drag, resize and rotate straight away. Typing into it is
 * a second step, taken the same way as for any other element — double-click,
 * Enter / F2, or the context menu — all of which the stage lets through for
 * this one box because of `isUntouchedTextBox` below.
 */
export function insertTextBox(place: Placement): void {
  // The box before this one is settled first, while its insertion is still the
  // newest step on the stack.
  //
  // The stage would settle it anyway — `insertElement` below selects what it
  // creates, and the selection leaving the previous box is one of the signals
  // to take it back — but one step too late. By the time that runs, the second
  // insertion is the newest command, `revoke` refuses anything older, and the
  // first box has to be removed as an edit of its own instead: two boxes in a
  // row left 挿入 / 挿入 / 削除 on the history, and a single ⌘Z handed the
  // invisible first box back. Settling on the way in keeps the common case the
  // cheap one.
  settlePendingTextBox();

  const command = insertElement(
    textBoxHtml(place),
    t('command.insertShape', { shape: t('shape.textBox') }),
  );
  const uid = useSelectionStore.getState().uid;
  if (!command || !uid) return;

  pending = { uid, command };
}

/** Whether nothing a reader would see is inside. */
export function isBlank(element: Element): boolean {
  return element.textContent?.trim() === '' && element.querySelector(NON_TEXT_CONTENT) === null;
}

/**
 * Whether `uid` is the box just inserted, still without a word in it.
 *
 * The stage asks this wherever it asks `isTextEditable`, as an `||`: a box that
 * has just been inserted has no text of its own yet, so the rule for what a
 * double-click may enter refuses it. Widening that rule instead was rejected —
 * it would let every empty `<div>` a deck happens to contain be edited, and the
 * same function decides what counts as background.
 *
 * Both arguments are needed and neither is redundant. The uid is what makes it
 * *this* box and not any other; the element is what makes it *still* empty, and
 * this module holds no DOM reference of its own to check that with (invariant 6).
 */
export function isUntouchedTextBox(uid: string, element: Element): boolean {
  return pending?.uid === uid && isBlank(element);
}

/**
 * The box just inserted, for the stage to watch: it is the one element whose
 * selection leaving means "take the insertion back", and the one empty element
 * the placeholder may be painted on outside a text session.
 *
 * A uid, not the element — the caller resolves it through the bridge, which is
 * the only thing allowed to touch the stage DOM (invariant 6).
 */
export function pendingTextBoxUid(): string | null {
  return pending?.uid ?? null;
}

/**
 * Takes back the text box that was inserted and never used, and forgets the
 * insertion either way.
 *
 * Revoking is what makes an abandoned box cost nothing: the insertion is
 * normally still the newest step, and dropping it leaves no undo step for a box
 * the user never wanted. Anything recorded since — a font picked in the
 * inspector before a single key was pressed, or the box dragged somewhere
 * better — puts it out of reach, and the removal has to be an edit of its own.
 * That is unchanged from when a session end was the only thing that called
 * this; only the callers are new.
 */
export function dropTextBox(uid: string): void {
  const insertion = pending;
  pending = null;
  if (!insertion || insertion.uid !== uid) return;
  if (revoke(insertion.command)) return;

  const element = getActiveStage()?.resolve(uid);
  if (!element) return;
  // Recorded before the selection is let go of, so the snapshot's "before"
  // names the box and undoing this hands it back selected — the same order
  // `deleteSelection` uses (actions.ts).
  withHtmlSnapshot(t('command.deleteElement'), () => element.remove());
  // A uid left pointing at markup that no longer exists reads as a live
  // selection everywhere downstream: no handles are drawn, because nothing
  // resolves, but `hasSelection` stays true — so ⌘D, Delete and the format
  // brush all look available and then quietly do nothing.
  //
  // Only this branch needs it. The revoking branch above puts the markup back
  // as it was before the insertion and restores the selection with it
  // (`HtmlSnapshotCommand.revert`), and the stage's own signal — the selection
  // having already moved to another element — never matches this condition.
  const selection = useSelectionStore.getState();
  if (selection.uid === uid) selection.clear();
}

/**
 * Ends the record on the user's behalf, for callers that are about to read or
 * copy a slide's markup rather than to leave the box.
 *
 * The box is in the document store from the moment it is inserted
 * (`withHtmlSnapshot` commits as it records) and it is invisible while empty,
 * so anything that takes a slide's html carries it along: duplicating a slide
 * reproduced the box on the copy, and undoing a slide removal brought it back.
 *
 * The signals the stage watches do not reach those. Duplicating a slide asks
 * for no slide focus at all, so no `slide:changed` is emitted; a reorder that
 * lands on the index already on screen is swallowed by `setSlideIndex`'s early
 * return; and none of them move the selection off the box. Hence an explicit
 * entry point instead of one more thing inferred from a side effect.
 *
 * Unlike `dropTextBox`, this one checks the box is still empty before taking
 * the insertion back. `dropTextBox`'s callers each know why they are calling —
 * a text session that ended has already asked `isUntouchedTextBox`, and the
 * selection leaving a box that had been typed into cannot happen because the
 * session end forgot the record first. This caller knows nothing of the sort:
 * it fires because the user reached for the deck's shape, at a moment that has
 * no relation to what is in the box. A box with words in it is the user's, so
 * only the record is spent.
 */
export function settlePendingTextBox(): void {
  const insertion = pending;
  if (!insertion) return;

  const element = getActiveStage()?.resolve(insertion.uid);
  // Gone already, or no longer empty: nothing to take back either way. Note
  // the missing element is not passed to `dropTextBox` — reverting the
  // insertion writes a whole slide's markup back, and doing that when the box
  // is not where we left it would write it over the wrong slide.
  if (!element || !isBlank(element)) {
    pending = null;
    return;
  }
  dropTextBox(insertion.uid);
}

/** Forgets the insertion without touching it: the box has text and is staying. */
export function forgetTextBox(): void {
  pending = null;
}
