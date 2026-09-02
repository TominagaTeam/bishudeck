import { beforeEach, describe, expect, it } from 'vitest';

import { clearHistory, redo, setActiveStage, undo, useHistory } from '../core/commands/engine';
import { composeSlideDocument } from '../core/document/compose';
import { useDocumentStore } from '../core/document/store';
import { useSelectionStore } from '../core/selection/store';
import { buildProject } from '../import/pipeline';
import { StageBridge } from './bridge';
import { GestureController } from './interactions';

// jsdom ships no CSS.escape; both target WebViews have it.
if (typeof CSS === 'undefined') {
  globalThis.CSS = { escape: (value: string) => value } as never;
}

const DECK = `<!doctype html>
<html>
  <body>
    <section class="slide"><h1 class="headline">タイトル</h1><p>本文</p></section>
  </body>
</html>`;

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

  const controller = new GestureController(bridge, {
    onGuides: () => {},
    onChange: () => {},
    onMeasure: () => {},
  });
  return { bridge, doc, controller };
}

/**
 * Alt-drag.
 *
 * jsdom measures every box as zero, so every candidate line sits at 0 and only
 * a drag that ends within the 6px threshold can be pulled onto one. These drags
 * all travel further than that, which keeps the guides out of the answer — the
 * subject here is the copy.
 */
describe('GestureController: Alt-drag duplicates', () => {
  beforeEach(() => {
    useSelectionStore.getState().clear();
  });

  it('leaves the copy at the start and moves the original', () => {
    const { bridge, doc, controller } = mountStage();
    const headline = doc.querySelector('.headline') as HTMLElement;
    const uid = bridge.uidOf(headline)!;
    useSelectionStore.getState().select(uid);

    controller.beginMove(0, 0, uid);
    controller.move(60, 40, { shift: false, alt: true });
    controller.end();

    const copies = doc.querySelectorAll('.headline');
    expect(copies).toHaveLength(2);
    // The original is still the one under the pointer, so it keeps its uid.
    expect(bridge.uidOf(copies[0]!)).toBe(uid);
    expect((copies[0] as HTMLElement).style.transform).toContain('translate(60px, 40px)');
    expect((copies[1] as HTMLElement).style.transform).toBe('');
  });

  it('records one undo step that takes the copy with it', () => {
    const { bridge, doc, controller } = mountStage();
    const uid = bridge.uidOf(doc.querySelector('.headline')!)!;
    useSelectionStore.getState().select(uid);

    controller.beginMove(0, 0, uid);
    controller.move(30, 0, { shift: false, alt: true });
    controller.move(60, 40, { shift: false, alt: true });
    controller.end();

    expect(useHistory.getState().undoStack).toHaveLength(1);

    undo();
    const after = doc.querySelectorAll('.headline');
    expect(after).toHaveLength(1);
    expect((after[0] as HTMLElement).style.transform).toBe('');

    redo();
    expect(doc.querySelectorAll('.headline')).toHaveLength(2);
  });

  it('copies only once however long the drag runs', () => {
    const { bridge, doc, controller } = mountStage();
    const uid = bridge.uidOf(doc.querySelector('.headline')!)!;

    controller.beginMove(0, 0, uid);
    for (let step = 1; step <= 5; step += 1) {
      controller.move(step * 10, step * 5, { shift: false, alt: true });
    }
    controller.end();

    expect(doc.querySelectorAll('.headline')).toHaveLength(2);
  });

  it('does not copy when the pointer never moved', () => {
    const { bridge, doc, controller } = mountStage();
    const uid = bridge.uidOf(doc.querySelector('.headline')!)!;

    controller.beginMove(20, 20, uid);
    controller.move(20, 20, { shift: false, alt: true });
    controller.end();

    expect(doc.querySelectorAll('.headline')).toHaveLength(1);
    expect(useHistory.getState().undoStack).toHaveLength(0);
  });

  it('takes the copy away again when the drag is cancelled', () => {
    const { bridge, doc, controller } = mountStage();
    const uid = bridge.uidOf(doc.querySelector('.headline')!)!;

    controller.beginMove(0, 0, uid);
    controller.move(60, 40, { shift: false, alt: true });
    controller.cancel();

    const left = doc.querySelectorAll('.headline');
    expect(left).toHaveLength(1);
    expect((left[0] as HTMLElement).style.transform).toBe('');
    // Abandoned drags are not history.
    expect(useHistory.getState().undoStack).toHaveLength(0);
  });

  it('still records a plain move as a style change', () => {
    const { bridge, doc, controller } = mountStage();
    const uid = bridge.uidOf(doc.querySelector('.headline')!)!;

    controller.beginMove(0, 0, uid);
    controller.move(60, 40, { shift: false, alt: false });
    controller.end();

    expect(doc.querySelectorAll('.headline')).toHaveLength(1);
    expect(useHistory.getState().undoLabel).toBe('移動');
  });
});

/**
 * The dead zone, which keeps a click from moving anything.
 *
 * The drags that are expected to land somewhere clear the 6px threshold, so
 * snapping cannot move them — see the note above the Alt-drag block.
 */
describe('GestureController: a press has to travel before it drags', () => {
  beforeEach(() => {
    useSelectionStore.getState().clear();
  });

  it('leaves the element alone when the press never clears the dead zone', () => {
    const { bridge, doc, controller } = mountStage();
    const headline = doc.querySelector('.headline') as HTMLElement;
    const uid = bridge.uidOf(headline)!;

    controller.beginMove(0, 0, uid, 1);
    controller.move(3, 0, { shift: false, alt: false });
    controller.move(2, 2, { shift: false, alt: false });
    controller.end();

    expect(headline.style.transform).toBe('');
    expect(useHistory.getState().undoStack).toHaveLength(0);
  });

  it('follows the whole delta from the start once the dead zone is cleared', () => {
    const { bridge, doc, controller } = mountStage();
    const headline = doc.querySelector('.headline') as HTMLElement;
    const uid = bridge.uidOf(headline)!;

    controller.beginMove(0, 0, uid, 1);
    controller.move(3, 0, { shift: false, alt: false });
    controller.move(10, 0, { shift: false, alt: false });
    controller.end();

    // 10, not 6: re-basing on the crossing point would leave the element
    // trailing the pointer by the dead zone for the rest of the drag.
    expect(headline.style.transform).toContain('translate(10px, 0px)');
    expect(useHistory.getState().undoLabel).toBe('移動');
  });

  it('widens the dead zone as the stage zooms out', () => {
    const { bridge, doc, controller } = mountStage();
    const headline = doc.querySelector('.headline') as HTMLElement;
    const uid = bridge.uidOf(headline)!;

    // At 50% the four screen pixels are eight stage pixels.
    controller.beginMove(0, 0, uid, 0.5);
    controller.move(6, 0, { shift: false, alt: false });
    expect(headline.style.transform).toBe('');

    controller.move(10, 0, { shift: false, alt: false });
    expect(headline.style.transform).toContain('translate(10px, 0px)');
  });

  it('does not leave an Alt copy behind for a press that never drags', () => {
    const { bridge, doc, controller } = mountStage();
    const uid = bridge.uidOf(doc.querySelector('.headline')!)!;

    controller.beginMove(0, 0, uid, 1);
    controller.move(3, 0, { shift: false, alt: true });
    controller.end();

    expect(doc.querySelectorAll('.headline')).toHaveLength(1);
    expect(useHistory.getState().undoStack).toHaveLength(0);
  });
});

/**
 * Shift on a move, which locked nothing and turned snapping off instead.
 * Resize (aspect ratio) and rotate (15° steps) already read it
 * the way PowerPoint does; this is the third one catching up.
 *
 * Every drag here travels further than the 6px snapping threshold, so the
 * numbers below are the lock's doing and not a guide's.
 */
describe('GestureController: Shift locks a move to one axis', () => {
  beforeEach(() => {
    useSelectionStore.getState().clear();
  });

  it('drops the vertical travel when the drag is mostly horizontal', () => {
    const { bridge, doc, controller } = mountStage();
    const headline = doc.querySelector('.headline') as HTMLElement;
    const uid = bridge.uidOf(headline)!;

    controller.beginMove(0, 0, uid, 1);
    controller.move(60, 40, { shift: true, alt: false });
    controller.end();

    expect(headline.style.transform).toContain('translate(60px, 0px)');
  });

  it('drops the horizontal travel when the drag is mostly vertical', () => {
    const { bridge, doc, controller } = mountStage();
    const headline = doc.querySelector('.headline') as HTMLElement;
    const uid = bridge.uidOf(headline)!;

    controller.beginMove(0, 0, uid, 1);
    controller.move(40, 60, { shift: true, alt: false });
    controller.end();

    expect(headline.style.transform).toContain('translate(0px, 60px)');
  });

  it('changes axis when the drag turns a corner', () => {
    const { bridge, doc, controller } = mountStage();
    const headline = doc.querySelector('.headline') as HTMLElement;
    const uid = bridge.uidOf(headline)!;

    controller.beginMove(0, 0, uid, 1);
    controller.move(60, 10, { shift: true, alt: false });
    expect(headline.style.transform).toContain('translate(60px, 0px)');

    // The lock follows the larger travel, so the drag does not have to be
    // released to change its mind.
    controller.move(10, 60, { shift: true, alt: false });
    controller.end();

    expect(headline.style.transform).toContain('translate(0px, 60px)');
  });

  it('hands the other axis back when Shift is let go mid-drag', () => {
    const { bridge, doc, controller } = mountStage();
    const headline = doc.querySelector('.headline') as HTMLElement;
    const uid = bridge.uidOf(headline)!;

    controller.beginMove(0, 0, uid, 1);
    controller.move(60, 40, { shift: true, alt: false });
    controller.move(60, 40, { shift: false, alt: false });
    controller.end();

    expect(headline.style.transform).toContain('translate(60px, 40px)');
  });

  it('keeps the still axis out of the snapping search', () => {
    const { bridge, doc } = mountStage();
    const headline = doc.querySelector('.headline') as HTMLElement;
    const uid = bridge.uidOf(headline)!;

    // jsdom lays nothing out, so every box measures zero and every candidate
    // line sits at 0 — which is what makes the still axis snap onto a guide at
    // a delta of 0 unless it is kept out of the search altogether.
    const guides: string[] = [];
    const controller = new GestureController(bridge, {
      onGuides: (found) => {
        guides.length = 0;
        guides.push(...found.map((guide) => guide.orientation));
      },
      onChange: () => {},
      onMeasure: () => {},
    });

    controller.beginMove(0, 0, uid, 1);
    controller.move(60, 0, { shift: false, alt: false });
    expect(guides).toContain('horizontal');

    controller.move(60, 40, { shift: true, alt: false });
    expect(guides).not.toContain('horizontal');
    controller.end();
  });
});

/**
 * The handles, which have the same two problems the layer had: a press that
 * barely travels still committed something, and a resize left the
 * size it pinned behind after an undo.
 */
describe('GestureController: the handles leave a click alone', () => {
  beforeEach(() => {
    useSelectionStore.getState().clear();
  });

  it('writes nothing when a resize handle is pressed and released', () => {
    const { bridge, doc, controller } = mountStage();
    const headline = doc.querySelector('.headline') as HTMLElement;
    const uid = bridge.uidOf(headline)!;

    controller.beginResize(0, 0, uid, 'se', 1);
    controller.move(2, 2, { shift: true, alt: false });
    controller.end();

    // Not just an empty `style`: the attribute must never have been written.
    expect(headline.hasAttribute('style')).toBe(false);
    expect(useHistory.getState().undoStack).toHaveLength(0);
  });

  it('takes the pinned size back with the undo of a resize', () => {
    const { bridge, doc, controller } = mountStage();
    const headline = doc.querySelector('.headline') as HTMLElement;
    const uid = bridge.uidOf(headline)!;

    controller.beginResize(0, 0, uid, 'se', 1);
    controller.move(60, 40, { shift: true, alt: false });
    controller.end();
    expect(headline.style.width).not.toBe('');

    undo();
    // The element started with no `style` at all, so that is what it has to
    // get back — a leftover `width` would freeze a box that grows with its text.
    expect(doc.querySelector('.headline')!.hasAttribute('style')).toBe(false);
  });

  it('writes nothing when a rotate handle is pressed and released', () => {
    const { bridge, doc, controller } = mountStage();
    const headline = doc.querySelector('.headline') as HTMLElement;
    const uid = bridge.uidOf(headline)!;

    controller.beginRotate(0, 0, uid, 1);
    controller.move(3, 0, { shift: false, alt: false });
    controller.end();

    expect(headline.hasAttribute('style')).toBe(false);
    expect(useHistory.getState().undoStack).toHaveLength(0);
  });

  it('rotates once the press clears the dead zone', () => {
    const { bridge, doc, controller } = mountStage();
    const headline = doc.querySelector('.headline') as HTMLElement;
    const uid = bridge.uidOf(headline)!;

    controller.beginRotate(0, 0, uid, 1);
    controller.move(0, 20, { shift: false, alt: false });
    controller.end();

    expect(headline.style.transform).toContain('rotate(');
    expect(useHistory.getState().undoLabel).toBe('回転');
  });

  it('widens the handles\' dead zone as the stage zooms out', () => {
    const { bridge, doc, controller } = mountStage();
    const headline = doc.querySelector('.headline') as HTMLElement;
    const uid = bridge.uidOf(headline)!;

    // At 50% the four screen pixels are eight stage pixels.
    controller.beginResize(0, 0, uid, 'se', 0.5);
    controller.move(6, 0, { shift: true, alt: false });
    expect(headline.hasAttribute('style')).toBe(false);

    controller.move(20, 0, { shift: true, alt: false });
    expect(headline.style.width).not.toBe('');
  });
});
