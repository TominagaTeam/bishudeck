import { beforeEach, describe, expect, it } from 'vitest';

import { clearHistory, setActiveStage, undo, useHistory } from '../commands/engine';
import { composeSlideDocument } from '../document/compose';
import { useDocumentStore } from '../document/store';
import { useSelectionStore } from '../selection/store';
import { buildProject } from '../../import/pipeline';
import { StageBridge } from '../../stage/bridge';
import { useTextEditRequest } from '../../stage/textEditRequest';
import { t } from '../../shared/i18n';
import { nudge } from './actions';
import { TEXT_BOX_SIZE, defaultPlacement } from './shapes';
import {
  dropTextBox,
  forgetTextBox,
  insertTextBox,
  isBlank,
  isUntouchedTextBox,
  pendingTextBoxUid,
  settlePendingTextBox,
} from './textBox';

// jsdom ships no CSS.escape; both target WebViews have it.
if (typeof CSS === 'undefined') {
  globalThis.CSS = { escape: (value: string) => value } as never;
}

const DECK = `<!doctype html>
<html>
  <body>
    <section class="slide"><h1 class="headline">タイトル</h1></section>
  </body>
</html>`;

/** Wires a real stage to the real stores, the way EditStage does on load. */
function mountStage() {
  const project = buildProject(DECK, 'generic');
  useDocumentStore.getState().loadProject(project, null);
  clearHistory();

  const html = composeSlideDocument(project.shared, project.slides[0], { mode: 'edit' });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const bridge = new StageBridge(doc, () => {
    useDocumentStore.getState().setSlideHtml(project.slides[0].id, bridge.serializeSlide());
  });
  setActiveStage(bridge);
  return { bridge, doc };
}

const PLACE = defaultPlacement(1280, 720, TEXT_BOX_SIZE.width, TEXT_BOX_SIZE.height);

/** The box that was just inserted, as the stage would resolve it. */
function inserted(bridge: StageBridge) {
  const uid = useSelectionStore.getState().uid as string;
  return { uid, element: bridge.resolve(uid) as HTMLElement };
}

beforeEach(() => {
  useSelectionStore.getState().clear();
  useTextEditRequest.getState().clear();
  forgetTextBox();
});

describe('insertTextBox', () => {
  it('inserts an empty box, leaves it selected, and opens no text session', () => {
    const { bridge } = mountStage();

    insertTextBox(PLACE);

    const { uid, element } = inserted(bridge);
    // Nothing the editor chose to say lands in the user's document; the prompt
    // is drawn by the stage over the empty box (stage/placeholder.ts).
    expect(element.innerHTML).toBe('');
    expect(element.textContent).toBe('');
    // Selected, not being typed into. A box in a text session cannot be
    // dragged — the interaction layer stands aside for the whole session — so
    // the box a user had just placed could not be moved. Selection is the state
    // that offers the handles.
    expect(useSelectionStore.getState().uid).toBe(uid);
    expect(useTextEditRequest.getState().uid).toBeNull();
    // The insertion is still on record, which is what lets the stage let the
    // user back into an element with no text in it, and what it drops when the
    // selection moves on.
    expect(pendingTextBoxUid()).toBe(uid);
  });

  it('is sized by what is in it, with one line as the floor', () => {
    const { bridge } = mountStage();

    insertTextBox(PLACE);

    const { element } = inserted(bridge);
    // No `height`: the browser sizes the box to its content, so a Return makes
    // it taller as the line lands and nothing has to watch the typing for it —
    // which matters, because the frame runs no scripts and a keystroke inside
    // it is not something the host can see (ADR-0002). It used to carry a flat
    // `height:90px` and stayed 90px however many lines went in.
    expect(element.style.height).toBe('');
    // The floor is one line, and it is what keeps an empty box findable: with
    // nothing at all an empty one is zero pixels tall, and the frame and
    // handles would be drawn on a line with no thickness.
    expect(element.style.minHeight).toBe(`${PLACE.height}px`);
    expect(PLACE.height).toBe(Math.round(28 * 1.5));
  });

  it('remembers only the box it just inserted', () => {
    const { bridge, doc } = mountStage();
    // An empty element of the deck's own, which is what widening the rule for
    // "may be edited" would have swept in (decisions #75, rejected option ②).
    const theirs = doc.createElement('div');
    doc.querySelector('.slide')!.append(theirs);
    bridge.reindex();
    const theirUid = bridge.uidOf(theirs) as string;

    insertTextBox(PLACE);
    const { uid, element } = inserted(bridge);

    expect(isUntouchedTextBox(uid, element)).toBe(true);
    expect(isBlank(theirs)).toBe(true);
    expect(isUntouchedTextBox(theirUid, theirs)).toBe(false);
    // The uid is what picks the box out; the element only answers "still
    // empty?". The pair is expected to describe the same element — every caller
    // resolves one from the other — so a mismatched pair says nothing useful,
    // and is pinned here only so that the split of duties stays visible.
    expect(isUntouchedTextBox(theirUid, element)).toBe(false);
  });

  it('stops answering for the box once the insertion is forgotten', () => {
    const { bridge } = mountStage();

    insertTextBox(PLACE);
    const { uid, element } = inserted(bridge);
    expect(pendingTextBoxUid()).toBe(uid);

    forgetTextBox();

    // The door closes with the record: an empty box that is no longer the one
    // just inserted is an ordinary element with no text, and `isTextEditable`
    // alone decides those.
    expect(isUntouchedTextBox(uid, element)).toBe(false);
    expect(pendingTextBoxUid()).toBeNull();
  });

  it('stops answering for the box once it is dropped', () => {
    const { bridge } = mountStage();

    insertTextBox(PLACE);
    const { uid } = inserted(bridge);

    dropTextBox(uid);

    expect(pendingTextBoxUid()).toBeNull();
  });

  // The stage calls `dropTextBox` when the selection leaves the box, or when the
  // slide it is on is about to be swapped out (stage/EditStage.tsx). It used to
  // be the end of the text session the insertion opened; what the call does is
  // unchanged, so these three still describe the whole of it.
  it('leaves nothing behind when it is dropped without being typed into', () => {
    const { bridge, doc } = mountStage();
    const before = bridge.serializeSlide();

    insertTextBox(PLACE);
    const { uid, element } = inserted(bridge);
    expect(doc.querySelectorAll('.slide > div')).toHaveLength(1);

    expect(isUntouchedTextBox(uid, element)).toBe(true);
    dropTextBox(uid);

    expect(doc.querySelectorAll('.slide > div')).toHaveLength(0);
    expect(bridge.serializeSlide()).toBe(before);
    // Revoked rather than undone: an insertion nobody wanted costs no undo step
    // and offers nothing to redo.
    expect(useHistory.getState().canUndo).toBe(false);
    expect(useHistory.getState().canRedo).toBe(false);
  });

  it('keeps a box that was typed into', () => {
    const { bridge, doc } = mountStage();

    insertTextBox(PLACE);
    const { uid, element } = inserted(bridge);
    element.textContent = 'ここに書いた';

    expect(isUntouchedTextBox(uid, element)).toBe(false);
    // What the stage does when a session on the box ends with words in it.
    forgetTextBox();
    // The record is spent: emptying the same box later is an edit of the user's
    // own content, not an insertion to take back.
    element.textContent = '';
    dropTextBox(uid);

    expect(doc.querySelectorAll('.slide > div')).toHaveLength(1);
    expect(useHistory.getState().canUndo).toBe(true);
  });

  it('removes the box as an edit of its own once another step is on the stack', () => {
    const { bridge, doc } = mountStage();

    insertTextBox(PLACE);
    const { uid } = inserted(bridge);
    // Something recorded between the insertion and the decision — moving the
    // empty box, or picking a font in the inspector — puts the insertion out of
    // revoking range. Dragging the box is now the ordinary thing to do with it
    // before typing, so this is the common shape and not the corner it was.
    nudge(10, 0);
    expect(useHistory.getState().canUndo).toBe(true);

    dropTextBox(uid);

    expect(doc.querySelectorAll('.slide > div')).toHaveLength(0);
    undo();
    expect(doc.querySelectorAll('.slide > div')).toHaveLength(1);
  });

  it('drops the selection when it removes the box it was on', () => {
    const { bridge } = mountStage();

    insertTextBox(PLACE);
    const { uid } = inserted(bridge);
    // Puts the insertion out of revoking range, so the box has to go as an
    // edit of its own — the branch that leaves an element behind to unselect.
    nudge(10, 0);

    dropTextBox(uid);

    // Left pointing at the removed box, the uid draws no handles (nothing
    // resolves) while still reading as a selection, so ⌘D / Delete / the
    // format brush all appear usable and do nothing.
    expect(useSelectionStore.getState().uid).toBeNull();
  });

  it('takes back the box before it when a second one is inserted', () => {
    const { bridge, doc } = mountStage();

    insertTextBox(PLACE);
    const first = inserted(bridge).uid;
    insertTextBox(PLACE);
    const second = inserted(bridge).uid;

    expect(second).not.toBe(first);
    // Only the second box is on the slide: nothing was typed into the first.
    expect(doc.querySelectorAll('.slide > div')).toHaveLength(1);
    expect(pendingTextBoxUid()).toBe(second);
    // One step, and it is the insertion. Waiting for the selection to move —
    // which is what the stage watches — gets here after the second insertion
    // has become the newest step, and `revoke` only ever accepts that one, so
    // the first box was removed as an edit instead: 挿入 / 挿入 / 削除, with
    // one ⌘Z handing the invisible first box back.
    const stack = useHistory.getState().undoStack;
    expect(stack.map((command) => command.label)).toEqual([
      t('command.insertShape', { shape: t('shape.textBox') }),
    ]);
  });
});

/**
 * The signal for callers that are about to read or copy a slide's markup —
 * duplicating a slide, removing one, reordering the deck — rather than for the
 * user leaving the box behind. Those never move the selection off it and do
 * not all emit `slide:changed`, so nothing the stage watches would fire.
 */
describe('settlePendingTextBox', () => {
  it('does nothing when no insertion is on record', () => {
    mountStage();

    settlePendingTextBox();

    expect(pendingTextBoxUid()).toBeNull();
    expect(useHistory.getState().canUndo).toBe(false);
  });

  it('takes the unused box back and costs no history step', () => {
    const { bridge, doc } = mountStage();
    const before = bridge.serializeSlide();

    insertTextBox(PLACE);
    expect(doc.querySelectorAll('.slide > div')).toHaveLength(1);

    settlePendingTextBox();

    expect(pendingTextBoxUid()).toBeNull();
    expect(doc.querySelectorAll('.slide > div')).toHaveLength(0);
    expect(bridge.serializeSlide()).toBe(before);
    expect(useHistory.getState().canUndo).toBe(false);

    // Asked again by the next command in the same gesture — a drag reorder
    // records one per step — and there is nothing left to do.
    settlePendingTextBox();
    expect(useHistory.getState().canUndo).toBe(false);
  });

  it('leaves a box that has words in it alone', () => {
    const { bridge, doc } = mountStage();

    insertTextBox(PLACE);
    const { element } = inserted(bridge);
    element.textContent = 'ここに書いた';

    // Unlike `dropTextBox`'s callers, this one has no idea what state the box
    // is in: it fires because the user reached for the deck's shape. A box
    // with words in it is the user's, so only the record is spent.
    settlePendingTextBox();

    expect(pendingTextBoxUid()).toBeNull();
    expect(doc.querySelectorAll('.slide > div')).toHaveLength(1);
  });
});

describe('isBlank', () => {
  it('counts a box holding only what the browser leaves behind as empty', () => {
    const { doc } = mountStage();
    const box = doc.createElement('div');
    doc.querySelector('.slide')!.append(box);

    expect(isBlank(box)).toBe(true);
    // What Chrome and WebKit put in a contenteditable emptied by the user.
    box.innerHTML = '<br>';
    expect(isBlank(box)).toBe(true);
    box.innerHTML = ' \n ';
    expect(isBlank(box)).toBe(true);
  });

  it('does not count content that has nothing to say in text', () => {
    const { doc } = mountStage();
    const box = doc.createElement('div');
    doc.querySelector('.slide')!.append(box);

    box.innerHTML = '<img src="assets/a.png" alt="">';
    expect(isBlank(box)).toBe(false);
    box.innerHTML = '文字';
    expect(isBlank(box)).toBe(false);
  });
});
