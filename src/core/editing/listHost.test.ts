// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  anchorsOf,
  anchorsRestorableIn,
  lostDeclarations,
  planListCommand,
  rebuildListHost,
  retagElement,
  unwrapList,
} from './listHost';

/**
 * The three hosts that defeat `execCommand`, as a table of what to do about
 * each. The measurements behind the table are in listHost.ts; what is tested
 * here is that the rule matches them and that nothing else is disturbed.
 */
describe('planListCommand', () => {
  it('unwraps a list the button would build again', () => {
    expect(planListCommand('UL', 'insertUnorderedList')).toBe('unwrapList');
    expect(planListCommand('OL', 'insertOrderedList')).toBe('unwrapList');
  });

  it('retags a list when the other kind is asked for', () => {
    expect(planListCommand('UL', 'insertOrderedList')).toBe('retagList');
    expect(planListCommand('OL', 'insertUnorderedList')).toBe('retagList');
  });

  it('rehosts the two tags a list cannot be built in', () => {
    expect(planListCommand('SPAN', 'insertUnorderedList')).toBe('rehost');
    expect(planListCommand('P', 'insertUnorderedList')).toBe('rehost');
  });

  it('leaves every other host to the browser', () => {
    for (const tag of ['DIV', 'H1', 'H2', 'STRONG', 'EM', 'A', 'LABEL', 'B']) {
      expect(planListCommand(tag, 'insertUnorderedList')).toBe('direct');
    }
  });

  it('never rebuilds for a command that is not a list', () => {
    expect(planListCommand('UL', 'bold')).toBe('direct');
    expect(planListCommand('P', 'justifyCenter')).toBe('direct');
  });
});

describe('lostDeclarations', () => {
  it('keeps only what the tag change took away', () => {
    const before = { 'font-size': '26px', color: 'rgb(0, 0, 0)' };
    const after = { 'font-size': '16px', color: 'rgb(0, 0, 0)' };
    expect(lostDeclarations(before, after)).toEqual({ 'font-size': '26px' });
  });

  it('carries nothing when the look survives', () => {
    const values = { 'font-size': '26px', 'line-height': '2' };
    expect(lostDeclarations(values, { ...values })).toEqual({});
  });

  // An engine that resolves nothing — jsdom, or a property it does not know —
  // says nothing about what the tag was doing, and `font-size: ;` in a slide's
  // markup would be the editor's own damage.
  it('never writes back an unresolved property', () => {
    expect(lostDeclarations({ 'font-size': '' }, { 'font-size': '16px' })).toEqual({});
  });
});

describe('retagElement', () => {
  it('keeps every attribute, uid included', () => {
    document.body.innerHTML =
      '<p data-hse-uid="u1" class="lead" style="color: red">本文</p>';
    const paragraph = document.querySelector('p') as HTMLElement;

    const rebuilt = retagElement(paragraph, 'DIV');

    expect(rebuilt.tagName).toBe('DIV');
    expect(rebuilt.getAttribute('data-hse-uid')).toBe('u1');
    expect(rebuilt.className).toBe('lead');
    expect(rebuilt.style.color).toBe('red');
    expect(document.querySelector('p')).toBeNull();
  });

  // The whole reason the children are moved rather than cloned: a range the
  // caller took before the swap has to still address the same text.
  it('moves the children rather than copying them', () => {
    document.body.innerHTML = '<p data-hse-uid="u1">本文</p>';
    const paragraph = document.querySelector('p') as HTMLElement;
    const text = paragraph.firstChild as Text;

    const rebuilt = retagElement(paragraph, 'DIV');

    expect(rebuilt.firstChild).toBe(text);
    expect(text.isConnected).toBe(true);
  });
});

describe('unwrapList', () => {
  // What a press of 箇条書き wrote on the way in: the gutter the marker needs,
  // the UA margin flattened under it, the marker placement an aligned list
  // needs. None of it means anything once the marker is gone.
  it('takes the marker’s box off the lines it gives back', () => {
    document.body.innerHTML =
      '<ul data-hse-uid="u1" style="padding-left: 1.2em; margin-top: 0px; margin-bottom: 0px;' +
      ' list-style-position: inside; text-align: center"><li data-hse-uid="u2">一行目</li></ul>';
    const list = document.querySelector('ul') as HTMLElement;

    const rebuilt = unwrapList(list);

    expect(rebuilt.style.paddingLeft).toBe('');
    expect(rebuilt.style.marginTop).toBe('');
    expect(rebuilt.style.listStylePosition).toBe('');
    // An alignment is about lines, not about the list, and outlives it.
    expect(rebuilt.style.textAlign).toBe('center');
  });

  it('leaves no empty style attribute behind', () => {
    document.body.innerHTML =
      '<ul data-hse-uid="u1" style="padding-left: 1.2em"><li>一行目</li></ul>';
    const list = document.querySelector('ul') as HTMLElement;

    expect(unwrapList(list).hasAttribute('style')).toBe(false);
  });

  it('turns the list and its items into plain blocks', () => {
    document.body.innerHTML =
      '<ul data-hse-uid="u1"><li data-hse-uid="u2">一行目</li><li data-hse-uid="u3">二行目</li></ul>';
    const list = document.querySelector('ul') as HTMLElement;

    const rebuilt = unwrapList(list);

    expect(rebuilt.tagName).toBe('DIV');
    expect(rebuilt.getAttribute('data-hse-uid')).toBe('u1');
    expect(Array.from(rebuilt.children).map((child) => child.tagName)).toEqual(['DIV', 'DIV']);
    expect(rebuilt.textContent).toBe('一行目二行目');
    expect(document.querySelector('li')).toBeNull();
  });
});

describe('rebuildListHost', () => {
  it('swaps a bulleted host for a numbered one', () => {
    document.body.innerHTML = '<ul data-hse-uid="u1"><li>一行目</li></ul>';
    const list = document.querySelector('ul') as HTMLElement;

    const rebuilt = rebuildListHost('retagList', list, 'insertOrderedList');

    expect(rebuilt.tagName).toBe('OL');
    expect(rebuilt.getAttribute('data-hse-uid')).toBe('u1');
    expect(rebuilt.querySelectorAll('li')).toHaveLength(1);
  });

  it('gives a span host a block to build the list in', () => {
    document.body.innerHTML = '<span data-hse-uid="u1" style="display: block">見出し</span>';
    const span = document.querySelector('span') as HTMLElement;

    const rebuilt = rebuildListHost('rehost', span, 'insertUnorderedList');

    expect(rebuilt.tagName).toBe('DIV');
    expect(rebuilt.getAttribute('data-hse-uid')).toBe('u1');
  });

  it('leaves a host the browser can handle alone', () => {
    document.body.innerHTML = '<h2 data-hse-uid="u1">見出し</h2>';
    const heading = document.querySelector('h2') as HTMLElement;

    expect(rebuildListHost('direct', heading, 'insertUnorderedList')).toBe(heading);
    expect(heading.tagName).toBe('H2');
  });
});

describe('anchors across a rebuild', () => {
  it('keeps a selection that was inside the text', () => {
    document.body.innerHTML = '<p data-hse-uid="u1">本文です</p>';
    const paragraph = document.querySelector('p') as HTMLElement;
    const text = paragraph.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 2);
    const anchors = anchorsOf(range);

    const rebuilt = retagElement(paragraph, 'DIV');

    expect(anchorsRestorableIn(anchors, rebuilt)).toBe(true);
    expect(anchors.startContainer).toBe(text);
  });

  // Why the anchors are plain values and not the `Range`: moving the children
  // is enough to drag a live range's boundaries out to the element, and taking
  // the element away drags them out again — still valid, around the wrong thing.
  it('shows the live range drifting out of the box on its own', () => {
    document.body.innerHTML = '<section><p data-hse-uid="u1">本文です</p></section>';
    const paragraph = document.querySelector('p') as HTMLElement;
    const range = document.createRange();
    range.setStart(paragraph.firstChild as Text, 0);
    range.setEnd(paragraph.firstChild as Text, 2);

    const rebuilt = retagElement(paragraph, 'DIV');

    expect(rebuilt.contains(range.startContainer)).toBe(false);
  });

  it('falls back when the anchor was the element itself', () => {
    document.body.innerHTML = '<section><p data-hse-uid="u1">本文です</p></section>';
    const paragraph = document.querySelector('p') as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const anchors = anchorsOf(range);

    const rebuilt = retagElement(paragraph, 'DIV');

    expect(anchorsRestorableIn(anchors, rebuilt)).toBe(false);
  });
});

/**
 * Why `<p>` is on the rehost list at all. The command succeeds inside a
 * paragraph and the result reads fine in the DOM; it is only re-parsing —
 * which is what opening a saved deck does — that shows the box emptying and the
 * list walking out of it. Invariant 2 ② asks for a fixed point across that
 * round trip, so the shape is asserted here rather than left to be rediscovered.
 */
describe('round trip through the parser', () => {
  const reparse = (html: string) => {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    return doc.body.innerHTML;
  };

  it('does not survive a list inside a paragraph', () => {
    const html = '<p data-hse-uid="u1"><ul><li>一行目</li></ul></p>';
    expect(reparse(html)).not.toBe(html);
  });

  it('survives the block the rehost produces', () => {
    const html = '<div data-hse-uid="u1"><ul><li>一行目</li></ul></div>';
    expect(reparse(html)).toBe(html);
  });
});
