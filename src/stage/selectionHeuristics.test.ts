import { beforeEach, describe, expect, it } from 'vitest';

import { SLIDE_ROOT_ATTRIBUTE } from '../core/document/compose';
import { BLANK_ATTRIBUTE } from './placeholder';
import {
  ancestryOf,
  chooseSelectionTarget,
  isTextEditable,
  selectionStack,
  siblingStep,
  stackStep,
  stepOutward,
} from './selectionHeuristics';

/**
 * jsdom measures every box as zero, so the coverage rule is exercised by
 * stubbing the rects it reads. The layout that produces those rects is only
 * ever checked by hand.
 */
function slide(html: string): HTMLElement {
  document.body.innerHTML = `<section ${SLIDE_ROOT_ATTRIBUTE}>${html}</section>`;
  return document.body.firstElementChild as HTMLElement;
}

/** jsdom measures everything as zero, so the geometry has to be stated outright. */
function box(element: Element, left: number, top: number, width: number, height: number): void {
  element.getBoundingClientRect = () =>
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

/** A 1280x720 slide, the size every deck in the wild turns out to be. */
function slideBox(root: Element): void {
  box(root, 0, 0, 1280, 720);
}

describe('chooseSelectionTarget', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('selects the block a clicked word belongs to, not the inline span', () => {
    const root = slide('<h1>今期の<span>ハイライト</span></h1>');
    const span = root.querySelector('span')!;
    expect(chooseSelectionTarget(span)).toBe(root.querySelector('h1'));
  });

  it('stops at the first block-level ancestor', () => {
    const root = slide('<div class="card"><p>本文</p></div>');
    expect(chooseSelectionTarget(root.querySelector('p')!)).toBe(root.querySelector('p'));
  });

  it('treats the slide itself as empty space rather than as an object', () => {
    // Selecting the slide root would put resize and rotate handles on the whole
    // slide, which is never what a click on the background means.
    const root = slide('<h1>見出し</h1>');
    expect(chooseSelectionTarget(root)).toBeNull();
  });

  it('treats an element whose ancestry never reaches a slide root as backdrop', () => {
    document.body.innerHTML = '<div class="shell"><p>本文</p></div>';
    const shell = document.body.firstElementChild as HTMLElement;
    expect(chooseSelectionTarget(shell)).toBeNull();
  });

  it('reads a click on a container that fills the slide as a click on nothing', () => {
    // The complaint this rule exists for: clicking the padding around an AI
    // deck's layout wrapper handed back a "shape" the size of the whole slide.
    const root = slide('<div class="wrap" style="display:block"><h1>見出し</h1></div>');
    const wrap = root.querySelector('.wrap')!;
    slideBox(root);
    box(wrap, 0, 0, 1280, 720);
    expect(chooseSelectionTarget(wrap)).toBeNull();
  });

  it('does not read a box the editor emptied as backdrop', () => {
    // The counterpart to the rule above. A box the user has emptied carries no
    // words to save it from the full-bleed test, and a full-bleed heading is a
    // real shape someone put there — so without the mark, emptying one handed
    // back "you clicked on nothing" and the box could not be reached again.
    const root = slide(`<h1 class="hero" ${BLANK_ATTRIBUTE} style="display:block"></h1>`);
    const hero = root.querySelector('.hero')!;
    slideBox(root);
    box(hero, 0, 0, 1280, 720);
    expect(chooseSelectionTarget(hero)).toBe(hero);
  });

  it('reads a wrapper inset from every edge as the slide surface too', () => {
    // `inset: 24px` covers only 90% of the slide by area, which the old
    // area-ratio rule let through — and a 1232x672 box with rotate handles on
    // it is the whole slide as far as anyone using it is concerned.
    const root = slide('<div class="inner" style="display:block"><h2>見出し</h2></div>');
    const inner = root.querySelector('.inner')!;
    slideBox(root);
    box(inner, 24, 24, 1232, 672);
    expect(chooseSelectionTarget(inner)).toBeNull();
  });

  it('reads a full-bleed background layer as the slide surface', () => {
    // How generated decks paint their background: an empty <div> pinned to
    // inset:0 under the content. It is the first thing any click on blank
    // slide lands on, so leaving it selectable made the whole slide the
    // default selection.
    const root = slide('<div class="bg" style="display:block"></div><h1>見出し</h1>');
    const bg = root.querySelector('.bg')!;
    slideBox(root);
    box(bg, 0, 0, 1280, 720);
    expect(chooseSelectionTarget(bg)).toBeNull();
  });

  it('still selects a container that is merely large', () => {
    const root = slide('<div class="grid" style="display:block"><p>カード</p></div>');
    const grid = root.querySelector('.grid')!;
    slideBox(root);
    box(grid, 0, 0, 1280, 500);
    expect(chooseSelectionTarget(grid)).toBe(grid);
  });

  it('keeps a full-bleed image selectable', () => {
    // Media is content the user placed, so neither its size nor its default
    // `display:inline` may hand the click to whatever wraps it.
    const root = slide('<img class="hero" src="a.png" alt="">');
    const hero = root.querySelector('.hero')!;
    slideBox(root);
    box(hero, 0, 0, 1280, 720);
    expect(chooseSelectionTarget(hero)).toBe(hero);
  });

  it('keeps an element with its own text selectable however big it is', () => {
    const root = slide('<div class="shape" style="display:block">図形</div>');
    const shape = root.querySelector('.shape')!;
    slideBox(root);
    box(shape, 0, 0, 1280, 720);
    expect(chooseSelectionTarget(shape)).toBe(shape);
  });

  it('keeps it selectable after formatting has wrapped that text', () => {
    // Bolding the words moves them inside a <b>, and a rule that only counted
    // direct text nodes read the banner as an empty full-bleed box from then on
    // — the deck's own title, demoted to scenery by having been styled.
    const root = slide('<div class="shape" style="display:block"><b>図形</b></div>');
    const shape = root.querySelector('.shape')!;
    slideBox(root);
    box(shape, 0, 0, 1280, 720);
    expect(chooseSelectionTarget(shape)).toBe(shape);
  });

  it('selects the text box a bullet belongs to, not the list plumbing', () => {
    // What 箇条書き leaves behind. Reading <ul>/<li> as objects put two more
    // selectable boxes on the slide and, worse, left the editing host inside
    // the list — where the button that made it can no longer take it off.
    const root = slide('<h2><ul><li>月間アクティブユーザー</li><li>解約率</li></ul></h2>');
    const item = root.querySelector('li')!;
    expect(chooseSelectionTarget(item)).toBe(root.querySelector('h2'));
  });

  it('stops at the list when it is the outermost thing in the slide', () => {
    // A deck that writes its list straight into the slide. Climbing one more
    // step would reach the slide root, which selection refuses — and a click on
    // real words would come back as a click on nothing.
    const root = slide('<ul><li>月間アクティブユーザー</li></ul>');
    const item = root.querySelector('li')!;
    expect(chooseSelectionTarget(item)).toBe(root.querySelector('ul'));
  });

  it('selects an image rather than the paragraph it sits in', () => {
    const root = slide('<p>図: <img class="fig" src="a.png" alt=""></p>');
    expect(chooseSelectionTarget(root.querySelector('.fig')!)).toBe(root.querySelector('.fig'));
  });

  it('selects the frame of a cropped picture, not the picture', () => {
    // The picture is deliberately bigger than what shows through, so selecting
    // it would draw the selection out where the trimmed-away part used to be.
    const root = slide(
      '<div class="frame" style="position:absolute;width:200px;height:150px;overflow:hidden">' +
        '<img class="pic" src="a.png" alt="" style="position:absolute;left:-50px;top:-30px;width:400px;height:300px">' +
        '</div>',
    );
    expect(chooseSelectionTarget(root.querySelector('.pic')!)).toBe(root.querySelector('.frame'));
  });

  it('keeps a full-bleed crop frame selectable, because it is a picture', () => {
    const root = slide(
      '<div class="frame" style="position:absolute;overflow:hidden">' +
        '<img class="pic" src="a.png" alt="" style="position:absolute">' +
        '</div>',
    );
    const frame = root.querySelector('.frame')!;
    slideBox(root);
    box(frame, 0, 0, 1280, 720);
    expect(chooseSelectionTarget(root.querySelector('.pic')!)).toBe(frame);
  });
});

describe('stepOutward', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('walks one container out', () => {
    const root = slide('<div class="card"><p>本文</p></div>');
    expect(stepOutward(root.querySelector('p')!)).toBe(root.querySelector('.card'));
  });

  it('stops before the slide root, so Escape deselects instead of selecting the slide', () => {
    const root = slide('<h1>見出し</h1>');
    expect(stepOutward(root.querySelector('h1')!)).toBeNull();
    expect(stepOutward(root)).toBeNull();
  });
});

describe('ancestryOf / isTextEditable', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('lists the chain from the outermost object down to the element', () => {
    const root = slide('<div class="card"><p>本文</p></div>');
    const chain = ancestryOf(root.querySelector('p')!);
    expect(chain.map((el) => el.tagName)).toEqual(['DIV', 'P']);
  });

  it('leaves the slide root out, because every crumb is selectable', () => {
    const root = slide('<div class="card"><p>本文</p></div>');
    expect(ancestryOf(root.querySelector('p')!)).not.toContain(root);
    expect(ancestryOf(root)).toEqual([]);
  });

  it('only offers text editing where there is text of its own', () => {
    const root = slide('<h1>見出し</h1><div><p>本文</p></div><img src="a.png" alt="">');
    expect(isTextEditable(root.querySelector('h1')!)).toBe(true);
    // A box around a paragraph is not a text box: the click lands on the
    // paragraph, so the paragraph is what offers to be edited.
    expect(isTextEditable(root.querySelector('div')!)).toBe(false);
    expect(isTextEditable(root.querySelector('img')!)).toBe(false);
  });

  it('offers text editing on the element a list belongs to', () => {
    // The list is how this text box's words are arranged, so the box is what
    // gets edited — which is also what puts the <ul> inside the editing host,
    // the only place execCommand can unwrap it again.
    const root = slide('<h2><ul><li>月間アクティブユーザー</li></ul></h2>');
    expect(isTextEditable(root.querySelector('h2')!)).toBe(true);
    expect(isTextEditable(root.querySelector('ul')!)).toBe(true);
  });

  it('still offers text editing on a box the editor has emptied', () => {
    // Emptying a box used to be a one-way door: with no text of its own it was
    // a deck's own empty <div> by every test here, so no double-click, Enter or
    // F2 would open it again. The mark is the stage saying it
    // knows this one is text; only the stage writes it, so the deck's own empty
    // boxes are still background.
    const root = slide(`<h1 ${BLANK_ATTRIBUTE}></h1><div class="rule"></div>`);
    expect(isTextEditable(root.querySelector('h1')!)).toBe(true);
    expect(isTextEditable(root.querySelector('.rule')!)).toBe(false);
  });

  it('still offers text editing once formatting has wrapped the text', () => {
    // The bug this counts against: execCommand always wraps what it styles, so
    // one Cmd+B used to leave the heading with no text node of its own and no
    // way back into editing the words that had just been bolded.
    const root = slide(
      '<h1><b>見出し</b></h1><p><span style="font-size:32px"><i>本文</i></span></p>',
    );
    expect(isTextEditable(root.querySelector('h1')!)).toBe(true);
    expect(isTextEditable(root.querySelector('p')!)).toBe(true);
  });
});

describe('siblingStep', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('moves to the next sibling and back again', () => {
    const root = slide('<h1>A</h1><p>B</p><p>C</p>');
    const [a, b, c] = Array.from(root.children);
    expect(siblingStep(a!, 1)).toBe(b);
    expect(siblingStep(b!, -1)).toBe(a);
    expect(siblingStep(b!, 1)).toBe(c);
  });

  it('wraps at both ends, so the key always does something', () => {
    const root = slide('<h1>A</h1><p>B</p><p>C</p>');
    const [a, , c] = Array.from(root.children);
    expect(siblingStep(c!, 1)).toBe(a);
    expect(siblingStep(a!, -1)).toBe(c);
  });

  it('skips a sibling a click would have refused', () => {
    // The wrapper covers the whole slide, so the click rules call it backdrop;
    // tabbing must not hand back what pointing at it never could.
    const root = slide('<h1>A</h1><div class="wrap" style="display:block"><p>x</p></div><p>C</p>');
    slideBox(root);
    const [a, wrap, c] = Array.from(root.children);
    box(a!, 40, 40, 200, 60);
    box(wrap!, 0, 0, 1280, 720);
    box(c!, 40, 400, 200, 60);
    expect(siblingStep(a!, 1)).toBe(c);
  });

  it('returns null when there is no other selectable sibling', () => {
    const root = slide('<h1>A</h1>');
    expect(siblingStep(root.firstElementChild!, 1)).toBeNull();
  });

  it('returns null for an element with no parent', () => {
    expect(siblingStep(document.createElement('div'), 1)).toBeNull();
  });
});

/**
 * `elementsFromPoint` is jsdom's to answer and it does not, so the pile is
 * handed in the way the browser would hand it over: front to back, deepest
 * node of each layer first, ancestors after their descendants.
 */
describe('selectionStack', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('names a box that an opaque shape is sitting on top of', () => {
    // The case the pile exists for: the shape answers a hit test and the box never
    // does, so nothing but the pile can say the box is still there.
    const root = slide('<div class="shape"></div><p class="buried">本文</p>');
    slideBox(root);
    const [shape, buried] = Array.from(root.children);
    box(shape!, 200, 200, 300, 200);
    box(buried!, 200, 200, 300, 200);
    expect(selectionStack([shape!, buried!, root])).toEqual([shape, buried]);
  });

  it('collapses hits that mean the same element', () => {
    // A word, its span and the heading around it are one entry, or stepping
    // through the pile would stall on the heading three times over.
    const root = slide('<h1>今期の<span>ハイライト</span></h1>');
    const h1 = root.querySelector('h1')!;
    const span = root.querySelector('span')!;
    expect(selectionStack([span, h1])).toEqual([h1]);
  });

  it('drops the hits a click would have refused', () => {
    const root = slide('<div class="bg"></div><p>本文</p>');
    slideBox(root);
    const [bg, text] = Array.from(root.children);
    box(bg!, 0, 0, 1280, 720);
    box(text!, 40, 40, 200, 60);
    expect(selectionStack([bg!, text!, root])).toEqual([text]);
  });
});

describe('stackStep', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('steps one further back and wraps at the end', () => {
    const root = slide('<p>A</p><p>B</p>');
    const [a, b] = Array.from(root.children);
    expect(stackStep([a!, b!], a!)).toBe(b);
    expect(stackStep([a!, b!], b!)).toBe(a);
  });

  it('starts at the front when the selection is not in the pile', () => {
    const root = slide('<p>A</p><p>B</p><p>elsewhere</p>');
    const [a, b, other] = Array.from(root.children);
    expect(stackStep([a!, b!], other!)).toBe(a);
    expect(stackStep([a!, b!], null)).toBe(a);
  });

  it('answers with nothing for an empty pile', () => {
    expect(stackStep([], null)).toBeNull();
  });
});
