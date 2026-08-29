import { describe, expect, it } from 'vitest';

import { clearHistory, setActiveStage, useHistory } from '../core/commands/engine';
import { composeSlideDocument } from '../core/document/compose';
import { useDocumentStore } from '../core/document/store';
import {
  CROPPING_ATTRIBUTE,
  CROP_OWNED_ATTRIBUTE,
  fitRect,
  isEditorFrame,
  pictureOf,
  scalePlacement,
  unframe,
  type CropTarget,
  type Placement,
} from '../core/editing/crop';
import { buildProject } from '../import/pipeline';
import { StageBridge } from './bridge';
import { CropController, PICTURE_GRIP, slidePicture, trimEdges, type CropStart } from './cropGesture';

// jsdom ships no CSS.escape; both target WebViews have it.
if (typeof CSS === 'undefined') {
  globalThis.CSS = { escape: (value: string) => value } as never;
}

/** A deck whose picture already sits in a clipping box, as an import leaves it. */
const CROP_DECK = `<!doctype html>
<html>
  <body>
    <section class="slide">
      <div class="frame" style="position:absolute;left:0;top:0;width:400px;height:300px;overflow:hidden">
        <img class="photo" src="photo.png" style="position:absolute;left:-100px;top:-50px;width:600px;height:400px;max-width:none">
      </div>
    </section>
  </body>
</html>`;

/** A 400x300 frame showing the middle of a 600x400 picture. */
function start(overrides: Partial<Placement> = {}): CropStart {
  return {
    base: {
      width: 400,
      height: 300,
      cx: 200,
      cy: 150,
      transform: { base: '', tx: 0, ty: 0, rotation: 0 },
    },
    placement: { left: -100, top: -50, width: 600, height: 400, ...overrides },
  };
}

describe('trimming the frame', () => {
  it('leaves the picture where it is on screen', () => {
    // The left edge comes in by 40, so the picture — positioned relative to the
    // frame — has to move the other way by the same amount.
    const next = trimEdges(start(), 'w', { x: 40, y: 0 });
    expect(next.offsetX).toBe(40);
    expect(next.width).toBe(360);
    expect(next.picture.left).toBe(-140);
    expect(next.picture.top).toBe(-50);
  });

  it('moves the far edge without touching the picture', () => {
    const next = trimEdges(start(), 'e', { x: -60, y: 0 });
    expect(next.offsetX).toBe(0);
    expect(next.width).toBe(340);
    expect(next.picture.left).toBe(-100);
  });

  it('changes both edges from a corner', () => {
    const next = trimEdges(start(), 'nw', { x: 30, y: 20 });
    expect(next.width).toBe(370);
    expect(next.height).toBe(280);
    expect(next.picture).toMatchObject({ left: -130, top: -70 });
  });

  it('stops at the edge of the picture rather than framing nothing', () => {
    // The picture only extends 100 past the frame's left edge.
    const next = trimEdges(start(), 'w', { x: -500, y: 0 });
    expect(next.offsetX).toBe(-100);
    expect(next.width).toBe(500);
    expect(next.picture.left).toBe(0);
  });

  it('stops the far edge at the picture too', () => {
    const next = trimEdges(start(), 'e', { x: 500, y: 0 });
    // 600 wide starting 100 left of the frame leaves 500 of frame to fill.
    expect(next.width).toBe(500);
  });

  it('never collapses the frame', () => {
    const next = trimEdges(start(), 'w', { x: 9999, y: 0 });
    expect(next.width).toBe(8);
  });
});

describe('sliding the picture', () => {
  it('moves it inside a frame that stays put', () => {
    const next = slidePicture(start(), { x: 25, y: -10 });
    expect(next.width).toBe(400);
    expect(next.height).toBe(300);
    expect(next.picture).toMatchObject({ left: -75, top: -60 });
  });

  it('never uncovers an edge of a picture larger than its frame', () => {
    expect(slidePicture(start(), { x: 999, y: 0 }).picture.left).toBe(0);
    expect(slidePicture(start(), { x: -999, y: 0 }).picture.left).toBe(-200);
    expect(slidePicture(start(), { x: 0, y: -999 }).picture.top).toBe(-100);
  });

  it('keeps a picture smaller than its frame inside it', () => {
    // 200x150 in a 400x300 frame: the limits arrive the other way round, and
    // clamping with them unswapped would pin the picture to one corner.
    const small = start({ left: 50, top: 40, width: 200, height: 150 });
    expect(slidePicture(small, { x: -999, y: 0 }).picture.left).toBe(0);
    expect(slidePicture(small, { x: 999, y: 0 }).picture.left).toBe(200);
  });
});

describe('where object-fit draws a picture', () => {
  const box = { width: 400, height: 300 };
  const wide = { width: 800, height: 400 };

  it('letterboxes a contained picture and centres it', () => {
    expect(fitRect(box, wide, 'contain', '50% 50%')).toEqual({
      left: 0,
      top: 50,
      width: 400,
      height: 200,
    });
  });

  it('overflows a covering picture', () => {
    const rect = fitRect(box, wide, 'cover', '50% 50%');
    expect(rect.width).toBe(600);
    expect(rect.height).toBe(300);
    expect(rect.left).toBe(-100);
  });

  it('draws an unfitted picture at its natural size', () => {
    expect(fitRect(box, wide, 'none', '50% 50%')).toMatchObject({ width: 800, height: 400 });
  });

  it('never enlarges under scale-down', () => {
    const small = { width: 100, height: 50 };
    expect(fitRect(box, small, 'scale-down', '50% 50%')).toMatchObject({ width: 100, height: 50 });
  });

  it('fills the box by default', () => {
    expect(fitRect(box, wide, 'fill', '50% 50%')).toEqual({ left: 0, top: 0, ...box });
  });

  it('honours object-position, as a fraction and as a length', () => {
    expect(fitRect(box, wide, 'contain', '50% 0%').top).toBe(0);
    expect(fitRect(box, wide, 'contain', '50% 100%').top).toBe(100);
    expect(fitRect(box, wide, 'contain', '0px 12px').top).toBe(12);
  });

  it('fills the box when the picture has no intrinsic size', () => {
    expect(fitRect(box, { width: 0, height: 0 }, 'contain', '50% 50%')).toEqual({
      left: 0,
      top: 0,
      ...box,
    });
  });
});


describe('scaling a picture with its frame', () => {
  const placement: Placement = { left: -100, top: -50, width: 600, height: 400 };

  it('scales offset and size together on the axis that changed', () => {
    // Widening the frame by half must widen the picture by half, or the same
    // gesture would reveal more of the photo instead of enlarging it.
    expect(scalePlacement(placement, 1.5, 1)).toEqual({
      left: -150,
      top: -50,
      width: 900,
      height: 400,
    });
  });

  it('leaves the other axis alone', () => {
    expect(scalePlacement(placement, 1, 0.5)).toEqual({
      left: -100,
      top: -25,
      width: 600,
      height: 200,
    });
  });
});

/** A frame as `wrap` writes one, around a picture the deck sized in percent. */
function framed(): { frame: HTMLElement; picture: HTMLElement } {
  const frame = document.createElement('div');
  frame.setAttribute('style', 'position:absolute;width:400px;height:300px;overflow:hidden');
  frame.setAttribute(CROP_OWNED_ATTRIBUTE, '');

  const picture = document.createElement('img');
  picture.setAttribute('style', 'position:absolute;left:-100px;top:-50px;width:600px;height:400px');
  frame.append(picture);

  const slide = document.createElement('div');
  slide.append(frame);
  return { frame, picture };
}

describe('taking a frame back off', () => {
  it('leaves the picture where the frame was', () => {
    const { frame, picture } = framed();
    const parent = frame.parentElement!;
    unframe(frame, picture);

    expect(parent.children).toHaveLength(1);
    expect(parent.firstElementChild).toBe(picture);
  });

  it("carries the frame's own move and rotation onto the picture", () => {
    const { frame, picture } = framed();
    frame.style.transform = 'translate(30px, 12px) rotate(15deg)';
    unframe(frame, picture);

    // Where the user put the object on the slide is not part of the crop.
    expect(picture.style.transform).toBe('translate(30px, 12px) rotate(15deg)');
  });

  it('refuses a frame the deck wrote itself', () => {
    const { frame } = framed();
    frame.removeAttribute(CROP_OWNED_ATTRIBUTE);
    expect(isEditorFrame(frame)).toBe(false);
  });
});

describe('recognising a frame', () => {
  it('still sees one whose clipping the open session has turned off', () => {
    // `[data-hse-cropping] { overflow: visible !important }` beats the inline
    // declaration, so the computed style alone would deny the frame mid-crop.
    const { frame } = framed();
    frame.style.removeProperty('overflow');
    expect(pictureOf(frame)).toBeNull();

    frame.setAttribute(CROPPING_ATTRIBUTE, '');
    expect(pictureOf(frame)?.tagName).toBe('IMG');
  });

  it('does not let the session mark stand in for the rest of the shape', () => {
    // The mark only vouches for the clipping the stage switched off; a picture
    // the deck laid out in flow is still not a crop.
    const { frame, picture } = framed();
    frame.setAttribute(CROPPING_ATTRIBUTE, '');
    picture.style.position = 'static';
    expect(pictureOf(frame)).toBeNull();
  });
});

/**
 * The dead zone on the crop grips, which is the same rule the move / resize /
 * rotate handles follow ([issues](../../docs/issues.md) #30, and #18 / #29
 * before it).
 *
 * jsdom measures every box as zero, so the frame's `base` is empty here and the
 * numbers a drag lands on are not the point — whether *anything* was written is.
 */
function mountCrop() {
  const project = buildProject(CROP_DECK, 'generic');
  useDocumentStore.getState().loadProject(project, null);
  clearHistory();

  const html = composeSlideDocument(project.shared, project.slides[0]!, { mode: 'edit' });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const bridge = new StageBridge(doc, () => {});
  setActiveStage(bridge);

  const frame = doc.querySelector('.frame') as HTMLElement;
  const picture = doc.querySelector('.photo') as HTMLElement;
  const target: CropTarget = {
    frameUid: bridge.uidOf(frame)!,
    pictureUid: bridge.uidOf(picture)!,
  };
  return { controller: new CropController(bridge, () => {}), picture, target };
}

describe('CropController: a grip has to travel before it crops', () => {
  it('writes nothing when the press never clears the dead zone', () => {
    const { controller, picture, target } = mountCrop();

    controller.begin(0, 0, target, 'w', 1);
    controller.move(3, 0);
    controller.move(2, 2);
    controller.end();

    // The picture is where the fixture left it, and a click is not history.
    expect(picture.style.left).toBe('-100px');
    expect(useHistory.getState().undoStack).toHaveLength(0);
  });

  it('records one step once the dead zone is cleared', () => {
    const { controller, picture, target } = mountCrop();

    controller.begin(0, 0, target, 'w', 1);
    controller.move(3, 0);
    controller.move(40, 0);
    controller.end();

    expect(picture.style.left).not.toBe('-100px');
    expect(useHistory.getState().undoStack).toHaveLength(1);
    expect(useHistory.getState().undoLabel).toBe('トリミング');
  });

  it('leaves the picture alone when the picture grip is only clicked', () => {
    const { controller, picture, target } = mountCrop();

    controller.begin(50, 50, target, PICTURE_GRIP, 1);
    controller.move(52, 51);
    controller.end();

    expect(picture.style.left).toBe('-100px');
    expect(useHistory.getState().undoStack).toHaveLength(0);
  });

  it('widens the dead zone as the stage zooms out', () => {
    const { controller, picture, target } = mountCrop();

    // At 50% the four screen pixels are eight stage pixels.
    controller.begin(0, 0, target, 'w', 0.5);
    controller.move(6, 0);
    expect(picture.style.left).toBe('-100px');

    controller.move(40, 0);
    expect(picture.style.left).not.toBe('-100px');
  });
});
