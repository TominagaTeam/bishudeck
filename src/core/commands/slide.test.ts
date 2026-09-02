import { beforeEach, describe, expect, it } from 'vitest';

import { useUiStore } from '../../app/uiStore';
import { composeSlideDocument } from '../document/compose';
import { useDocumentStore } from '../document/store';
import { forgetTextBox, insertTextBox, pendingTextBoxUid } from '../editing/textBox';
import { defaultPlacement } from '../editing/shapes';
import { useSelectionStore } from '../selection/store';
import { buildProject } from '../../import/pipeline';
import { StageBridge } from '../../stage/bridge';
import { clearHistory, execute, redo, setActiveStage, undo } from './engine';
import {
  DuplicateSlideCommand,
  MoveSlideCommand,
  RemoveSlideCommand,
} from './slide';

// jsdom ships no CSS.escape; both target WebViews have it.
if (typeof CSS === 'undefined') {
  globalThis.CSS = { escape: (value: string) => value } as never;
}

/**
 * Which slide is on screen after the deck's shape changes — undo included.
 *
 * The forward direction used to be set by whoever called the command, and the
 * revert by nobody, so undoing a delete or a reorder left the editor on a
 * different slide than the one being worked on.
 */
describe('slide index follows the deck', () => {
  const deck = () => useDocumentStore.getState().project.slides;
  const at = () => useUiStore.getState().slideIndex;

  beforeEach(() => {
    useDocumentStore.getState().reset();
    clearHistory();
    for (const [i, id] of ['a', 'b', 'c'].entries()) {
      useDocumentStore.getState().insertSlide({ id, html: `<section>${id}</section>` }, i);
    }
    useUiStore.getState().setSlideIndex(1);
  });

  it('restores the removed slide and returns to it on undo', () => {
    execute(new RemoveSlideCommand('b'));
    expect(deck().map((s) => s.id)).toEqual(['a', 'c']);
    // The slide that slid into the gap.
    expect(at()).toBe(1);

    undo();
    expect(deck().map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(at()).toBe(1);
  });

  it('lands on the last slide when the removed one was last', () => {
    useUiStore.getState().setSlideIndex(2);
    execute(new RemoveSlideCommand('c'));
    expect(at()).toBe(1);

    undo();
    expect(at()).toBe(2);
  });

  it('follows a reorder and goes back with its undo', () => {
    execute(new MoveSlideCommand(0, 2));
    expect(deck().map((s) => s.id)).toEqual(['b', 'c', 'a']);
    expect(at()).toBe(2);

    undo();
    expect(deck().map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(at()).toBe(0);
  });

  it('goes forward again on redo', () => {
    execute(new MoveSlideCommand(0, 2));
    undo();
    redo();
    expect(at()).toBe(2);
  });
});

/**
 * A text box that was inserted and never typed into is invisible and is already
 * in the document store, so anything that copies or keeps a slide's markup
 * carries it along. The stage takes it back when the selection leaves it or
 * when `slide:changed` fires, and none of these commands does either — so they
 * ask for it themselves (core/editing/textBox.ts).
 */
describe('an unused text box is settled before the deck changes shape', () => {
  const DECK = `<!doctype html>
<html>
  <body>
    <section class="slide"><h1 class="headline">1 枚目</h1></section>
    <section class="slide"><h1 class="headline">2 枚目</h1></section>
  </body>
</html>`;

  const PLACE = defaultPlacement(1280, 720, 520, 90);
  const slides = () => useDocumentStore.getState().project.slides;

  /** Wires a real stage to the first slide, the way EditStage does on load. */
  function mountStage() {
    const project = buildProject(DECK, 'generic');
    useDocumentStore.getState().loadProject(project, null);
    clearHistory();
    useSelectionStore.getState().clear();
    forgetTextBox();

    const html = composeSlideDocument(project.shared, project.slides[0], { mode: 'edit' });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const bridge = new StageBridge(doc, () => {
      useDocumentStore.getState().setSlideHtml(slides()[0].id, bridge.serializeSlide());
    });
    setActiveStage(bridge);
    return { bridge, doc };
  }

  it('keeps the box off a duplicate of the slide it sits on', () => {
    const { bridge, doc } = mountStage();
    const clean = bridge.serializeSlide();

    insertTextBox(PLACE);
    expect(doc.querySelectorAll('.slide > div')).toHaveLength(1);

    // `DuplicateSlideCommand` never asks for a slide focus, so the stage's
    // `slide:changed` listener is not reached and the copy used to be taken
    // with the empty box on it.
    execute(new DuplicateSlideCommand(slides()[0].id));

    expect(pendingTextBoxUid()).toBeNull();
    expect(slides()).toHaveLength(3);
    expect(slides()[0].html).toBe(clean);
    expect(slides()[1].html).toBe(clean);
  });

  it('keeps the box out of the copy a removal holds to put back', () => {
    const { bridge } = mountStage();
    const clean = bridge.serializeSlide();

    insertTextBox(PLACE);
    execute(new RemoveSlideCommand(slides()[0].id));
    expect(slides()).toHaveLength(1);

    undo();

    expect(slides()).toHaveLength(2);
    expect(slides()[0].html).toBe(clean);
  });

  it('settles even when the reorder lands where the deck already was', () => {
    const { bridge, doc } = mountStage();
    const clean = bridge.serializeSlide();

    insertTextBox(PLACE);
    // `focusSlide(0)` on a deck already showing slide 0: `setSlideIndex`
    // returns early, so no `slide:changed` is emitted at all.
    useUiStore.getState().setSlideIndex(0);
    execute(new MoveSlideCommand(1, 0));

    expect(pendingTextBoxUid()).toBeNull();
    expect(doc.querySelectorAll('.slide > div')).toHaveLength(0);
    expect(slides().map((s) => s.html)).toContain(clean);
  });

  it('does not settle again on redo', () => {
    mountStage();

    const command = new MoveSlideCommand(0, 1);
    execute(command);
    const steps = () => useDocumentStore.getState().project.slides.map((s) => s.id).join();
    const after = steps();

    undo();
    redo();

    // Nothing pending, nothing to settle — and settling on a redo would have
    // to record its own delete command in the middle of this one's `apply()`.
    expect(steps()).toBe(after);
    expect(pendingTextBoxUid()).toBeNull();
  });
});
