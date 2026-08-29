import { describe, expect, it } from 'vitest';

import {
  MIN_VISIBLE,
  boundsOf,
  boxOf,
  clampIntoView,
  readTransform,
  rotateVector,
  visibleBounds,
  writeTransform,
} from './geometry';
import { snapToGuides } from './snapping';

function element(style?: string): HTMLElement {
  const el = document.createElement('div');
  if (style) el.setAttribute('style', style);
  return el;
}

describe('editor transform', () => {
  it('round-trips what it writes', () => {
    const el = element();
    writeTransform(el, { base: '', tx: 12.5, ty: -30, rotation: 45 });
    expect(readTransform(el)).toEqual({ base: '', tx: 12.5, ty: -30, rotation: 45 });
  });

  it('treats an authored transform as the base and keeps it', () => {
    const el = element('transform: skewX(10deg)');
    expect(readTransform(el)).toEqual({ base: 'skewX(10deg)', tx: 0, ty: 0, rotation: 0 });

    writeTransform(el, { base: 'skewX(10deg)', tx: 20, ty: 0, rotation: 0 });
    expect(el.style.transform).toContain('skewX(10deg)');
    // The deck's own transform still applies first.
    expect(el.style.transform.indexOf('skewX')).toBeLessThan(el.style.transform.indexOf('translate'));
    expect(readTransform(el).base).toBe('skewX(10deg)');
  });

  it('removes the property entirely once nothing is offset', () => {
    const el = element();
    writeTransform(el, { base: '', tx: 10, ty: 10, rotation: 0 });
    writeTransform(el, { base: '', tx: 0, ty: 0, rotation: 0 });
    expect(el.getAttribute('style') ?? '').not.toContain('transform');
  });

  it('restores only the authored transform when the editor offset is cleared', () => {
    const el = element('transform: scale(2)');
    writeTransform(el, { base: 'scale(2)', tx: 0, ty: 0, rotation: 0 });
    expect(el.style.transform).toBe('scale(2)');
  });
});

describe('bounds', () => {
  const box = { cx: 100, cy: 100, width: 200, height: 100, rotation: 0 };

  it('matches the box exactly when unrotated', () => {
    expect(boundsOf(box)).toEqual({ left: 0, top: 50, right: 200, bottom: 150 });
  });

  it('grows to contain a rotated box', () => {
    const rotated = boundsOf({ ...box, rotation: 90 });
    expect(rotated.right - rotated.left).toBeCloseTo(100);
    expect(rotated.bottom - rotated.top).toBeCloseTo(200);
  });

  it('leaves the centre where it was, which is what makes the model work', () => {
    const rotated = boundsOf({ ...box, rotation: 37 });
    expect((rotated.left + rotated.right) / 2).toBeCloseTo(box.cx);
    expect((rotated.top + rotated.bottom) / 2).toBeCloseTo(box.cy);
  });
});

describe('boxOf', () => {
  /**
   * The inspector reads this box and writes `style.width`, so a width that came
   * back as the rotated bounding box shrank the shape every time it was retyped
   * (issues #9). SVG roots are the ones that hit it: they have no `offsetWidth`.
   */
  it('reports an SVG shape at its layout size, not its rotated bounds', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('style', 'width:360px;height:80px');
    document.body.append(svg);
    writeTransform(svg as unknown as HTMLElement, { base: '', tx: 0, ty: 0, rotation: 45 });

    const box = boxOf(svg as unknown as HTMLElement);
    expect(box.width).toBe(360);
    expect(box.height).toBe(80);
    expect(box.rotation).toBe(45);

    // The bounds it would occupy are much wider — that is the number the panel
    // used to show, and writing it back is what made the arrow shrink.
    expect(boundsOf(box).right - boundsOf(box).left).toBeGreaterThan(300);
    svg.remove();
  });

  it('still measures an HTML element from its offset box', () => {
    const div = document.createElement('div');
    // jsdom lays nothing out, so the layout box is supplied here; the point is
    // that the HTML branch reads it rather than falling through to the SVG one.
    Object.defineProperty(div, 'offsetWidth', { value: 200, configurable: true });
    Object.defineProperty(div, 'offsetHeight', { value: 100, configurable: true });
    div.setAttribute('style', 'width:999px;height:999px');
    document.body.append(div);

    const box = boxOf(div);
    expect([box.width, box.height]).toEqual([200, 100]);
    div.remove();
  });
});

describe('rotateVector', () => {
  it('turns a right-pointing vector downward at 90 degrees', () => {
    const turned = rotateVector(10, 0, 90);
    expect(turned.x).toBeCloseTo(0);
    expect(turned.y).toBeCloseTo(10);
  });
});

describe('smart guides', () => {
  const slide = { left: 0, top: 0, right: 1280, bottom: 720 };
  const other = { left: 100, top: 100, right: 300, bottom: 200 };

  it('snaps a near-aligned left edge onto the exact one', () => {
    const moving = { left: 103, top: 400, right: 203, bottom: 500 };
    const result = snapToGuides(moving, [other], slide);
    expect(result.dx).toBe(-3);
    expect(result.guides.some((g) => g.orientation === 'vertical' && g.position === 100)).toBe(true);
  });

  it('leaves a distant element alone', () => {
    const moving = { left: 600, top: 400, right: 700, bottom: 500 };
    const result = snapToGuides(moving, [other], slide);
    expect(result.dx).toBe(0);
    expect(result.dy).toBe(0);
    expect(result.guides).toHaveLength(0);
  });

  it('snaps to the slide centre, so centring by hand is exact', () => {
    const moving = { left: 538, top: 300, right: 738, bottom: 400 };
    const result = snapToGuides(moving, [], slide);
    expect(moving.left + result.dx + 100).toBeCloseTo(640);
  });

  it('prefers the closest of several candidates', () => {
    const near = { left: 105, top: 0, right: 205, bottom: 50 };
    const moving = { left: 104, top: 400, right: 204, bottom: 500 };
    const result = snapToGuides(moving, [other, near], slide);
    expect(result.dx).toBe(1);
  });

  // A resize only offers the edge under the pointer. Moving still offers all
  // six, and these fix that the default did not change when the option arrived.
  describe('restricted to chosen edges', () => {
    it('gives the same answer as before when no edges are named', () => {
      const moving = { left: 103, top: 400, right: 203, bottom: 500 };
      expect(snapToGuides(moving, [other], slide, {})).toEqual(
        snapToGuides(moving, [other], slide),
      );
      expect(snapToGuides(moving, [other], slide, undefined)).toEqual(
        snapToGuides(moving, [other], slide),
      );
    });

    it('ignores an edge that was not offered', () => {
      // The left edge is 3px from the other element's left (100), but the drag
      // is on the right edge — which sits at 453, clear of every candidate.
      const moving = { left: 103, top: 400, right: 453, bottom: 500 };
      const result = snapToGuides(moving, [other], slide, { x: ['right'], y: [] });
      expect(result.dx).toBe(0);
      expect(result.guides).toHaveLength(0);
    });

    it('still snaps the edge that was offered', () => {
      // The right edge is 2px short of the other element's right edge (300).
      const moving = { left: 198, top: 400, right: 298, bottom: 500 };
      const result = snapToGuides(moving, [other], slide, { x: ['right'], y: [] });
      expect(result.dx).toBe(2);
    });

    it('reports no movement on an axis with no edges', () => {
      const moving = { left: 103, top: 103, right: 203, bottom: 203 };
      const result = snapToGuides(moving, [other], slide, { x: [], y: [] });
      expect(result.dx).toBe(0);
      expect(result.dy).toBe(0);
      expect(result.guides).toHaveLength(0);
    });
  });
});

const SLIDE_ROOT = 'data-hse-slide-root';

/** jsdom measures everything as zero, so each box has to be stated outright. */
function box(el: Element, left: number, top: number, width: number, height: number): void {
  el.getBoundingClientRect = () =>
    ({
      width,
      height,
      top,
      left,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
    }) as DOMRect;
}

describe('visibleBounds', () => {
  it('narrows the slide by an ancestor that clips', () => {
    document.body.innerHTML = `<section ${SLIDE_ROOT} style="position:relative;overflow:hidden">
      <div id="card" style="position:absolute;overflow:hidden"><div id="inner"></div></div>
    </section>`;
    const slide = document.body.firstElementChild!;
    const card = document.getElementById('card')!;
    box(slide, 0, 0, 1280, 720);
    box(card, 100, 300, 400, 260);

    expect(visibleBounds(document.getElementById('inner')!, SLIDE_ROOT)).toEqual({
      left: 100,
      top: 300,
      right: 500,
      bottom: 560,
    });
  });

  it('stops at the slide, and the slide itself counts', () => {
    // The stage gives every slide root `overflow:hidden`
    // (import/detectors/deckStage.ts), so dragging past the slide edge loses an
    // element exactly the way dragging out of a card does.
    document.body.innerHTML = `<div id="shell" style="overflow:hidden">
      <section ${SLIDE_ROOT} style="position:relative;overflow:hidden"><div id="inner"></div></section>
    </div>`;
    const shell = document.getElementById('shell')!;
    const slide = shell.firstElementChild!;
    box(shell, -50, -50, 2000, 2000);
    box(slide, 0, 0, 1280, 720);

    expect(visibleBounds(document.getElementById('inner')!, SLIDE_ROOT)).toEqual({
      left: 0,
      top: 0,
      right: 1280,
      bottom: 720,
    });
  });

  it('ignores a static clipper the element is positioned out of', () => {
    // `overflow` only clips down the containing-block chain: an absolutely
    // positioned box hangs off the section, not off the static wrapper, so
    // refusing to drag it out of that wrapper would refuse a legal move.
    document.body.innerHTML = `<section ${SLIDE_ROOT} style="position:relative;overflow:hidden">
      <div id="wrap" style="position:static;overflow:hidden"><div id="inner" style="position:absolute"></div></div>
    </section>`;
    const slide = document.body.firstElementChild!;
    const wrap = document.getElementById('wrap')!;
    box(slide, 0, 0, 1280, 720);
    box(wrap, 100, 300, 400, 260);

    expect(visibleBounds(document.getElementById('inner')!, SLIDE_ROOT)).toEqual({
      left: 0,
      top: 0,
      right: 1280,
      bottom: 720,
    });
  });

  it('clips on one axis only when only one overflows', () => {
    document.body.innerHTML = `<section ${SLIDE_ROOT} style="position:relative;overflow-x:hidden;overflow-y:visible">
      <div id="inner"></div>
    </section>`;
    const slide = document.body.firstElementChild!;
    box(slide, 0, 0, 1280, 720);

    const bounds = visibleBounds(document.getElementById('inner')!, SLIDE_ROOT);
    expect([bounds.left, bounds.right]).toEqual([0, 1280]);
    expect([bounds.top, bounds.bottom]).toEqual([-Infinity, Infinity]);
  });
});

describe('clampIntoView', () => {
  const CLIP = { left: 0, top: 0, right: 1000, bottom: 500 };
  const BOX = { left: 100, top: 100, right: 300, bottom: 200 };

  it('lets a move that stays in view through untouched', () => {
    expect(clampIntoView(BOX, CLIP, 120, 60)).toEqual({ dx: 120, dy: 60 });
  });

  it('stops the box at the far edge with a grabbable strip left', () => {
    const { dx } = clampIntoView(BOX, CLIP, 5000, 0);
    expect(BOX.left + dx).toBe(CLIP.right - MIN_VISIBLE);
  });

  it('stops it at the near edge too', () => {
    const { dx, dy } = clampIntoView(BOX, CLIP, -5000, -5000);
    expect(BOX.right + dx).toBe(CLIP.left + MIN_VISIBLE);
    expect(BOX.bottom + dy).toBe(CLIP.top + MIN_VISIBLE);
  });

  it('gives up rather than pin a box bigger than the region it is clipped to', () => {
    // No offset leaves a margin on both sides, and refusing to move it at all
    // would be worse than putting it where the pointer says.
    const wide = { left: 0, top: 0, right: 4000, bottom: 100 };
    expect(clampIntoView(wide, CLIP, 90, 0).dx).toBe(90);
  });

  it('does nothing on an axis nothing clips', () => {
    const open = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
    expect(clampIntoView(BOX, open, 9000, -9000)).toEqual({ dx: 9000, dy: -9000 });
  });
});

