import { describe, expect, it } from 'vitest';

import { UID_ATTRIBUTE } from '../../shared/ids';
import {
  dropTrailingEmptyParagraphs,
  soleParagraphWrapper,
  trailingEmptyParagraph,
  unwrapSoleParagraphs,
} from './paragraphs';

/**
 * A text box as the stage holds one: stamped with a uid, holding exactly what
 * the browser would have left in it. Built with `innerHTML` so the markup in
 * each test reads as the measured output does, and so the parser — not the
 * test — decides what nodes there are.
 */
function box(inner: string): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute(UID_ATTRIBUTE, 'e1');
  element.innerHTML = inner;
  return element;
}

/** What the element holds after `unwrapSoleParagraphs`, for comparing markup. */
function unwrapped(inner: string): string {
  const element = box(inner);
  unwrapSoleParagraphs(element);
  return element.innerHTML;
}

describe('what counts as a wrapper that may go', () => {
  it('finds the lone div a box was left holding', () => {
    const element = box('<div>あ</div>');

    expect(soleParagraphWrapper(element)).toBe(element.firstElementChild);
  });

  // The reported shape: the first line stays bare and the second is wrapped.
  // Unwrapping here would run 「い」 onto 「あ」's line.
  it('leaves the wrapper alone when a bare first line sits beside it', () => {
    expect(soleParagraphWrapper(box('あ<div>い</div>'))).toBeNull();
  });

  // Two divs are two lines the user asked for, not one wrapper.
  it('leaves two divs alone, because the second one is a line break', () => {
    expect(soleParagraphWrapper(box('<div>あ</div><div>い</div>'))).toBeNull();
  });

  // What `execCommand('justifyCenter')` leaves on a single-line box. Taking
  // this off would quietly undo the alignment.
  it('keeps a div that declares something of its own', () => {
    expect(soleParagraphWrapper(box('<div style="color:red">あ</div>'))).toBeNull();
    expect(soleParagraphWrapper(box('<div class="lead">あ</div>'))).toBeNull();
    expect(soleParagraphWrapper(box('<div id="intro">あ</div>'))).toBeNull();
  });

  // `reindex()` stamps every element in the slide, so a uid says nothing about
  // the div — and serialization strips it anyway.
  it('does not count the uid as an attribute', () => {
    const element = box(`<div ${UID_ATTRIBUTE}="e2">あ</div>`);

    expect(soleParagraphWrapper(element)).toBe(element.firstElementChild);
  });

  it('only ever looks at a div', () => {
    expect(soleParagraphWrapper(box('<ul><li>あ</li></ul>'))).toBeNull();
    expect(soleParagraphWrapper(box('<p>あ</p>'))).toBeNull();
    expect(soleParagraphWrapper(box('<span>あ</span>'))).toBeNull();
  });

  it('has nothing to say about a box holding text or nothing at all', () => {
    expect(soleParagraphWrapper(box('あ'))).toBeNull();
    expect(soleParagraphWrapper(box(''))).toBeNull();
  });

  // A whitespace-only text node is still a node, and `white-space: pre-wrap`
  // makes it a visible one, so "exactly one child" is not measured after a trim.
  it('declines a div with whitespace around it', () => {
    expect(soleParagraphWrapper(box('\n  <div>あ</div>\n'))).toBeNull();
  });
});

describe('unwrapping', () => {
  it('leaves the content where the wrapper was', () => {
    expect(unwrapped('<div>あ</div>')).toBe('あ');
  });

  it('touches nothing the rule declined', () => {
    expect(unwrapped('あ<div>い</div>')).toBe('あ<div>い</div>');
    expect(unwrapped('<div>あ</div><div>い</div>')).toBe('<div>あ</div><div>い</div>');
    expect(unwrapped('<div style="color:red">あ</div>')).toBe('<div style="color:red">あ</div>');
    expect(unwrapped('<ul><li>あ</li></ul>')).toBe('<ul><li>あ</li></ul>');
  });

  it('keeps the markup inside the wrapper, line breaks included', () => {
    expect(unwrapped('<div>あ<br>い</div>')).toBe('あ<br>い');
    expect(unwrapped('<div><ul><li>あ</li></ul></div>')).toBe('<ul><li>あ</li></ul>');
  });

  it('leaves an empty box empty', () => {
    expect(unwrapped('<div></div>')).toBe('');
    expect(unwrapped('<div><br></div>')).toBe('<br>');
  });

  // Peeling one level per commit would make the same file shallower every time
  // it was opened and touched. Flattening the whole run means the next pass has
  // nothing left to do — see the idempotence tests below.
  it('takes off a whole run of wrappers, not just the top one', () => {
    expect(unwrapped('<div><div><div>あ</div></div></div>')).toBe('あ');
  });

  it('stops at the first level that declares something', () => {
    expect(unwrapped('<div><div class="pad"><div>あ</div></div></div>')).toBe(
      '<div class="pad"><div>あ</div></div>',
    );
  });

  // The caret lives in a text node; moving the node rather than rebuilding it
  // is what lets a range survive the unwrap.
  it('moves the existing nodes rather than rebuilding them', () => {
    const element = box('<div>あ</div>');
    const text = element.firstElementChild?.firstChild;

    unwrapSoleParagraphs(element);

    expect(element.firstChild).toBe(text);
  });
});

describe('the round trip settles (invariant 2 ②)', () => {
  const CASES = [
    '<div>あ</div>',
    '<div><div>あ</div></div>',
    'あ<div>い</div>',
    '<div>あ</div><div>い</div>',
    '<div style="color:red">あ</div>',
    '<div><br></div>',
  ];

  it('changes nothing on a second pass over the same element', () => {
    for (const markup of CASES) {
      const element = box(markup);
      unwrapSoleParagraphs(element);
      const once = element.innerHTML;

      unwrapSoleParagraphs(element);

      expect(element.innerHTML).toBe(once);
    }
  });

  // The real round trip: what was unwrapped is serialised, read back from the
  // saved file, and unwrapped again. A shape that keeps changing here is a file
  // that changes every time it is opened.
  it('changes nothing after being serialised and parsed back', () => {
    for (const markup of CASES) {
      const once = unwrapped(markup);

      expect(unwrapped(once)).toBe(once);
    }
  });
});

/**
 * `<p><div>z</div></p>` cannot be written as markup — the parser closes the
 * `<p>` before the `<div>` — but `execCommand` builds it in the live DOM the
 * moment Enter is pressed inside a `<p>`, and then serialising and reading back
 * splits one paragraph into three nodes. The 裁定 was about the doubled div, and
 * the sole-wrapper case of this comes out fixed with it.
 */
describe('the div a <p> cannot hold', () => {
  function paragraphWithNestedDiv(): HTMLElement {
    const paragraph = document.createElement('p');
    paragraph.setAttribute(UID_ATTRIBUTE, 'e1');
    const wrapper = document.createElement('div');
    wrapper.textContent = 'z';
    paragraph.append(wrapper);
    return paragraph;
  }

  /** How many nodes the markup comes back as when the file is read again. */
  function nodesAfterParsing(element: Element): number {
    const parsed = new DOMParser().parseFromString(element.outerHTML, 'text/html');
    return parsed.body.childNodes.length;
  }

  it('splits into several nodes while the div is still nested', () => {
    expect(nodesAfterParsing(paragraphWithNestedDiv())).toBeGreaterThan(1);
  });

  it('survives the round trip once the sole wrapper is off', () => {
    const paragraph = paragraphWithNestedDiv();

    unwrapSoleParagraphs(paragraph);

    expect(paragraph.innerHTML).toBe('z');
    expect(nodesAfterParsing(paragraph)).toBe(1);
  });
});

/**
 * The line Return leaves at the end.
 *
 * Return is not a way to commit, but it is what people press when they mean
 * "done"; `insertParagraph` mints a block for it, and the block outlives the
 * session. Measured on the user's own deck: `aaa` then Return gave
 * `aaa<div><br></div>`, and after the session that stray line carried a uid of
 * its own and drew a second selection frame inside the box.
 */
describe('the line Return leaves at the end', () => {
  it('takes the empty block off the end', () => {
    const target = box('aaa<div><br></div>');

    dropTrailingEmptyParagraphs(target);

    expect(target.innerHTML).toBe('aaa');
  });

  it('takes off as many as were pressed', () => {
    const target = box('aaa<div><br></div><div><br></div><div><br></div>');

    dropTrailingEmptyParagraphs(target);

    expect(target.innerHTML).toBe('aaa');
  });

  it('leaves a blank line between paragraphs alone', () => {
    // Spacing the user asked for: it is not at the end, so it is not the
    // Return that finished the sentence.
    const target = box('<div>aaa</div><div><br></div><div>bbb</div>');

    dropTrailingEmptyParagraphs(target);

    expect(target.innerHTML).toBe('<div>aaa</div><div><br></div><div>bbb</div>');
  });

  it('leaves a block that says something alone', () => {
    const target = box('aaa<div>bbb</div>');

    dropTrailingEmptyParagraphs(target);

    expect(target.innerHTML).toBe('aaa<div>bbb</div>');
  });

  it('leaves a block carrying a declaration alone', () => {
    // `execCommand('justifyCenter')` puts the alignment on the block; taking it
    // off would move the line the user aligned.
    const target = box('aaa<div style="text-align:center"><br></div>');

    expect(trailingEmptyParagraph(target)).toBeNull();
  });

  it('does not count the uid as a declaration', () => {
    const target = box(`aaa<div ${UID_ATTRIBUTE}="e1"><br ${UID_ATTRIBUTE}="e2"></div>`);

    dropTrailingEmptyParagraphs(target);

    expect(target.innerHTML).toBe('aaa');
  });

  it('leaves a block holding a picture alone, empty of text as it is', () => {
    const target = box('aaa<div><img src="assets/a.png" alt=""></div>');

    dropTrailingEmptyParagraphs(target);

    expect(target.innerHTML).toBe('aaa<div><img src="assets/a.png" alt=""></div>');
  });

  it('empties a box that holds nothing but the Return', () => {
    // Return pressed in a box with nothing in it. Emptying it is right: the box
    // is then blank again, and an inserted one that was never typed into is
    // taken back on that test (core/editing/textBox.ts).
    const target = box('<div><br></div><div><br></div>');

    dropTrailingEmptyParagraphs(target);

    expect(target.innerHTML).toBe('');
  });

  it('settles, so the same file does not change every time it is opened', () => {
    const target = box('aaa<div><br></div>');

    dropTrailingEmptyParagraphs(target);
    const once = target.innerHTML;
    dropTrailingEmptyParagraphs(target);

    expect(target.innerHTML).toBe(once);
  });

  it('hands the unwrap a single wrapper to take off', () => {
    // The two run as a pair, in this order, as the session commits.
    const target = box('<div>aaa</div><div><br></div>');

    dropTrailingEmptyParagraphs(target);
    unwrapSoleParagraphs(target);

    expect(target.innerHTML).toBe('aaa');
  });
});
