import { beforeEach, describe, expect, it } from 'vitest';

import { clearHistory, setActiveStage, undo } from '../commands/engine';
import { useSelectionStore } from '../selection/store';
import { StageBridge } from '../../stage/bridge';
import {
  CROPPING_ATTRIBUTE,
  CROP_OWNED_ATTRIBUTE,
  isCroppable,
  pictureOf,
  resetCrop,
  useCropSession,
  type CropTarget,
} from './crop';

/**
 * Opening and resetting a crop, against a real {@link StageBridge}.
 *
 * jsdom measures every box as zero, so none of the geometry means anything
 * here — what these check is the *structure*, which is where opening a crop on
 * the same picture twice used to go wrong.
 */

/** How an imported deck draws a photo: a clipping plate around a filled image. */
const PHOTO = `
  <div class="box" style="position:relative;width:100%;height:100%">
    <div class="plate" style="position:absolute;inset:0;overflow:hidden;background:rgba(127,127,127,.08)">
      <img src="a.png" style="display:block;width:100%;height:100%;object-fit:cover">
    </div>
  </div>`;

/** A picture with no frame of its own, sitting in the flow of a paragraph. */
const BARE = `<p>本文 <img src="b.png" style="width:120px;border-radius:8px"></p>`;

/**
 * Recognising a frame goes through `getComputedStyle`, so the slide has to live
 * in a document that has a window — a `DOMParser` one does not.
 */
function stage(body: string) {
  document.body.innerHTML = `<section data-hse-slide-root>${body}</section>`;
  const bridge = new StageBridge(document, () => {});
  setActiveStage(bridge);
  return { doc: document, bridge };
}

/** Selects the picture and opens a crop on it, the way a double-click does. */
function openCropOnPicture(bridge: StageBridge, doc: Document): CropTarget {
  const picture = doc.querySelector('img')!;
  useSelectionStore.getState().select(bridge.uidOf(picture)!);
  useCropSession.getState().start();
  return useCropSession.getState().target!;
}

beforeEach(() => {
  useCropSession.getState().stop();
  useSelectionStore.getState().clear();
  clearHistory();
  setActiveStage(null);
  document.body.innerHTML = '';
});

describe('opening a crop on a picture the deck already framed', () => {
  it('borrows the deck\'s own frame instead of adding one', () => {
    const { doc, bridge } = stage(PHOTO);
    const plate = doc.querySelector('.plate')!;
    const target = openCropOnPicture(bridge, doc);

    // Nesting a second frame here is what left the plate standing at its
    // pre-crop size around a trimmed picture.
    expect(plate.children).toHaveLength(1);
    expect(plate.firstElementChild!.tagName).toBe('IMG');
    expect(target.frameUid).toBe(bridge.uidOf(plate));

    const picture = doc.querySelector('img')!;
    expect(picture.style.position).toBe('absolute');
    expect(picture.style.objectFit).toBe('fill');
    // The frame is the author's element, so it keeps its own styling.
    expect(plate.getAttribute('style')).toContain('rgba(127,127,127,.08)');
    expect(plate.hasAttribute(CROP_OWNED_ATTRIBUTE)).toBe(false);
  });

  it('adds nothing at all the second time round', () => {
    const { doc, bridge } = stage(PHOTO);
    const plate = doc.querySelector('.plate')!;

    openCropOnPicture(bridge, doc);
    const afterFirst = plate.outerHTML;
    useCropSession.getState().stop();
    openCropOnPicture(bridge, doc);

    expect(plate.children).toHaveLength(1);
    // Reopening is not an edit: the record of the "before" must survive it.
    expect(plate.outerHTML).toBe(afterFirst);
  });

  it('gives the picture its own sizing back on reset, and leaves the frame', () => {
    const { doc, bridge } = stage(PHOTO);
    const plate = doc.querySelector('.plate')!;
    const plateStyle = plate.getAttribute('style');
    const target = openCropOnPicture(bridge, doc);

    resetCrop(target);

    expect(doc.querySelector('img')!.getAttribute('style')).toBe(
      'display:block;width:100%;height:100%;object-fit:cover',
    );
    expect(plate.getAttribute('style')).toBe(plateStyle);
    expect(plate.isConnected).toBe(true);
  });
});

describe('opening a crop on a bare picture', () => {
  it('wraps it in a frame of the editor\'s own', () => {
    const { doc, bridge } = stage(BARE);
    const target = openCropOnPicture(bridge, doc);

    const frame = bridge.resolve(target.frameUid) as HTMLElement;
    expect(frame.tagName).toBe('DIV');
    expect(frame.hasAttribute(CROP_OWNED_ATTRIBUTE)).toBe(true);
    expect(frame.firstElementChild!.tagName).toBe('IMG');
  });

  it('takes the frame away again on reset', () => {
    const { doc, bridge } = stage(BARE);
    const target = openCropOnPicture(bridge, doc);

    resetCrop(target);

    const picture = doc.querySelector('img')!;
    expect(picture.parentElement!.tagName).toBe('P');
    expect(picture.getAttribute('style')).toBe('width:120px;border-radius:8px');
    expect(doc.querySelectorAll('div')).toHaveLength(0);
  });

  it('does not leave the session mark behind for an undo to restore', () => {
    const { doc, bridge } = stage(BARE);
    const target = openCropOnPicture(bridge, doc);
    resetCrop(target);

    // The mark is taken off by whoever set it. Captured into the snapshot, it
    // would come back with no session running — and a frame carrying it never
    // clips again, so the whole uncropped picture spills out of its box.
    undo();
    expect(doc.querySelector(`[${CROPPING_ATTRIBUTE}]`)).toBeNull();
  });
});

describe('what may be mistaken for a frame', () => {
  it('never reads the slide itself as one', () => {
    // The shape a generated deck reaches for: the slide clips its design, and a
    // cover slide holds one full-bleed photo — which is the frame test to the
    // letter. Reading it as a frame sent every click on that photo up to the
    // slide root, where selection refuses it, and the picture stopped
    // responding to anything at all.
    document.body.innerHTML =
      `<section data-hse-slide-root style="position:relative;overflow:hidden">` +
      `<img src="a.png" style="position:absolute;left:0;top:0;width:100%;height:100%">` +
      `</section>`;
    const root = document.querySelector('section') as HTMLElement;

    expect(pictureOf(root)).toBeNull();
    expect(isCroppable(root)).toBe(false);
    // The picture itself is still croppable; it is only the slide that is not.
    expect(isCroppable(document.querySelector('img') as HTMLElement)).toBe(true);
  });

  it('still reads a frame the deck wrote inside the slide', () => {
    document.body.innerHTML =
      `<section data-hse-slide-root><div class="frame" style="position:relative;overflow:hidden">` +
      `<img src="a.png" style="position:absolute;left:-10px;top:0;width:200px;height:100px">` +
      `</div></section>`;
    const frame = document.querySelector('.frame') as HTMLElement;

    expect(pictureOf(frame)).toBe(document.querySelector('img'));
    expect(isCroppable(frame)).toBe(true);
  });
});
