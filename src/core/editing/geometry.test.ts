import { beforeEach, describe, expect, it } from 'vitest';

import { setGeometry } from './geometry';
import { clearHistory, setActiveStage, undo, useHistory } from '../commands/engine';
import { composeSlideDocument } from '../document/compose';
import { useDocumentStore } from '../document/store';
import { buildProject } from '../../import/pipeline';
import { readTransform } from '../../stage/geometry';
import { StageBridge } from '../../stage/bridge';

// jsdom ships no CSS.escape; both target WebViews have it.
if (typeof CSS === 'undefined') {
  globalThis.CSS = { escape: (value: string) => value } as never;
}

/** A heading the deck sized itself, and a photo already sitting in a frame. */
const DECK = `<!doctype html>
<html>
  <body>
    <section class="slide">
      <h1 class="title" style="color: rgb(255, 0, 0)">見出し</h1>
      <div class="frame" style="position:absolute;left:0;top:0;width:400px;height:300px;overflow:hidden">
        <img class="photo" src="photo.png" style="position:absolute;left:-100px;top:-50px;width:600px;height:400px">
      </div>
    </section>
  </body>
</html>`;

/**
 * jsdom lays nothing out, so what a browser would measure is modelled here:
 * the rect follows the inline size and the editor's own translate, which is
 * exactly the pair `boxOf` reads back off a real element.
 *
 * It has to answer *afresh* every time. A constant rect would hide the very
 * thing these tests are about — each keystroke measures the element again, and
 * one that kept answering with the size from before the first keystroke would
 * make every later one scale from the wrong baseline.
 */
function layOut(
  element: HTMLElement,
  base: { left: number; top: number; width: number; height: number },
): void {
  element.getBoundingClientRect = () => {
    const { tx, ty } = readTransform(element);
    return new DOMRect(
      base.left + tx,
      base.top + ty,
      parseFloat(element.style.width) || base.width,
      parseFloat(element.style.height) || base.height,
    );
  };
}

function mountStage() {
  const project = buildProject(DECK, 'generic');
  useDocumentStore.getState().loadProject(project, null);
  clearHistory();

  const html = composeSlideDocument(project.shared, project.slides[0]!, { mode: 'edit' });
  const frame = document.createElement('iframe');
  document.body.append(frame);
  // A real view, not `DOMParser`: `pictureOf` asks for computed styles, and a
  // parsed document has no `defaultView` to ask.
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();

  const bridge = new StageBridge(doc, () => {});
  setActiveStage(bridge);
  return { bridge, doc };
}

describe('setGeometry', () => {
  let bridge: StageBridge;
  let doc: Document;

  beforeEach(() => {
    document.body.innerHTML = '';
    ({ bridge, doc } = mountStage());
  });

  const heading = () => doc.querySelector('h1') as HTMLElement;
  const cropFrame = () => doc.querySelector('.frame') as HTMLElement;
  const photo = () => doc.querySelector('.photo') as HTMLElement;
  const uidOf = (element: HTMLElement) => bridge.uidOf(element)!;
  const steps = () => useHistory.getState().undoStack.length;

  describe('each keystroke lands on the slide', () => {
    /**
     * Typing 120 goes through 1 and 12, and every one of those has to arrive —
     * that is the whole point of the field applying as it is typed.
     *
     * It also pins down why the panel hands over no baseline of its own: each
     * call measures the element again, so "put X at 12" after "put X at 1" is a
     * move of 11. A baseline captured when the typing started would move it 12
     * more and leave the box at 13.
     */
    it('moves the element on every keystroke, measuring it again each time', () => {
      layOut(heading(), { left: 0, top: 0, width: 400, height: 100 });
      const uid = uidOf(heading());

      setGeometry(uid, 'x', 1);
      expect(readTransform(heading()).tx).toBe(1);

      setGeometry(uid, 'x', 12);
      expect(readTransform(heading()).tx).toBe(12);

      setGeometry(uid, 'x', 120);
      expect(readTransform(heading()).tx).toBe(120);
      expect(heading().getBoundingClientRect().left).toBe(120);
    });

    it('keeps the fraction the field is showing', () => {
      const uid = uidOf(heading());
      setGeometry(uid, 'rotation', 22.5);
      expect(readTransform(heading()).rotation).toBe(22.5);
    });

    it('refuses a size that would leave nothing to grab', () => {
      const uid = uidOf(heading());
      setGeometry(uid, 'width', 0);
      expect(heading().style.width).toBe('1px');
    });

    it('writes nothing for a value that is not a number', () => {
      const uid = uidOf(heading());
      const was = heading().style.cssText;
      setGeometry(uid, 'x', Number.NaN);

      expect(heading().style.cssText).toBe(was);
      expect(steps()).toBe(0);
    });
  });

  describe('a run of keystrokes is one undo step', () => {
    it('folds the whole run and undoes back past its first keystroke', () => {
      const uid = uidOf(heading());

      setGeometry(uid, 'x', 1);
      setGeometry(uid, 'x', 12);
      setGeometry(uid, 'x', 120);
      expect(steps()).toBe(1);

      undo();
      expect(readTransform(heading()).tx).toBe(0);
      expect(steps()).toBe(0);
    });

    /**
     * The sibling of issues #24: an element the deck sized in its own CSS gets
     * `width` written on it for the first time, and an undo that folded the run
     * onto the *last* snapshot would leave that width pinned — a box that no
     * longer grows with its text, in the exported file as well.
     */
    it('leaves no width pinned on an element that had none', () => {
      const uid = uidOf(heading());
      const was = heading().style.cssText;

      setGeometry(uid, 'width', 5);
      expect(heading().style.width).toBe('5px');
      setGeometry(uid, 'width', 50);
      expect(heading().style.width).toBe('50px');
      setGeometry(uid, 'width', 500);
      expect(heading().style.width).toBe('500px');

      undo();
      expect(heading().style.width).toBe('');
      expect(heading().style.cssText).toBe(was);
    });

    it('starts a new step when the field changes', () => {
      const uid = uidOf(heading());

      setGeometry(uid, 'width', 500);
      setGeometry(uid, 'height', 200);
      expect(steps()).toBe(2);

      // Only the second one comes back, which is what two steps has to mean.
      undo();
      expect(heading().style.height).toBe('');
      expect(heading().style.width).toBe('500px');
    });

    it('starts a new step when the element changes', () => {
      setGeometry(uidOf(heading()), 'x', 40);
      setGeometry(uidOf(cropFrame()), 'x', 40);
      expect(steps()).toBe(2);
    });
  });

  describe('a cropped picture follows its frame', () => {
    beforeEach(() => layOut(cropFrame(), { left: 0, top: 0, width: 400, height: 300 }));

    /**
     * The frame is the object on the slide and the picture is its content
     * (AD-6), so typing a width has to scale the photo rather than reveal more
     * of it. Each keystroke scales from what the last one left, so the run
     * composes to the same place a single 400 → 100 would.
     */
    it('scales the placement on every keystroke', () => {
      const uid = uidOf(cropFrame());

      setGeometry(uid, 'width', 200);
      expect(photo().style.left).toBe('-50px');
      expect(photo().style.width).toBe('300px');

      setGeometry(uid, 'width', 100);
      expect(photo().style.left).toBe('-25px');
      expect(photo().style.width).toBe('150px');
      // The axis the field does not own is left alone.
      expect(photo().style.top).toBe('-50px');
      expect(photo().style.height).toBe('400px');
    });

    it('gives the picture back exactly on undo, in one step', () => {
      const uid = uidOf(cropFrame());
      // `cssText` on both sides: restoring writes the captured attribute back
      // through the CSSOM, which re-serializes the spacing the deck wrote.
      const frameStyle = cropFrame().style.cssText;
      const photoStyle = photo().style.cssText;

      setGeometry(uid, 'width', 200);
      setGeometry(uid, 'width', 100);
      expect(steps()).toBe(1);

      undo();
      expect(photo().style.cssText).toBe(photoStyle);
      expect(cropFrame().style.cssText).toBe(frameStyle);
    });

    it('scales the other axis when the height is typed', () => {
      const uid = uidOf(cropFrame());

      setGeometry(uid, 'height', 150);
      expect(photo().style.top).toBe('-25px');
      expect(photo().style.height).toBe('200px');
      expect(photo().style.left).toBe('-100px');
      expect(photo().style.width).toBe('600px');
    });
  });
});
