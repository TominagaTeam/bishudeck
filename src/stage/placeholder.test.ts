import { describe, expect, it } from 'vitest';

import {
  BLANK_ATTRIBUTE,
  CARET_LINE_ATTRIBUTE,
  clearBlankMark,
  dropCaretLine,
  openCaretLine,
  placeholderRules,
  syncBlankMark,
} from './placeholder';

/**
 * The prompt 「テキストを入力」 must appear over empty elements and nowhere
 * else. It used to be selected with `:has(> br:only-child)`, which counts
 * child elements and ignores text nodes — so anything holding one `<br>` was
 * treated as empty, on every tag, however much the user had written in it
 * (issues #46). These cases are the ones that told the two apart.
 */
function element(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.firstElementChild as Element;
}

function marked(html: string): boolean {
  const target = element(html);
  syncBlankMark(target);
  return target.hasAttribute(BLANK_ATTRIBUTE);
}

describe('syncBlankMark', () => {
  it('marks an element with nothing at all in it', () => {
    expect(marked('<h1></h1>')).toBe(true);
  });

  it('marks what is left after everything in it was deleted', () => {
    // The lone <br> a browser mints when the last character goes.
    expect(marked('<h1><br></h1>')).toBe(true);
  });

  it('leaves a two-line heading alone', () => {
    expect(marked('<h1>見出し<br>2 行目</h1>')).toBe(false);
  });

  it('leaves a paragraph broken with one <br> alone', () => {
    expect(marked('<p>段落<br>2 行目</p>')).toBe(false);
  });

  it('leaves text followed by a trailing <br> alone', () => {
    expect(marked('<p>段落<br></p>')).toBe(false);
  });

  it.each(['h2', 'h3', 'div', 'span', 'li', 'blockquote'])(
    'leaves <%s> alone on the same shape — the bug was never about the tag',
    (tag) => {
      expect(marked(`<${tag}>本文<br>2 行目</${tag}>`)).toBe(false);
    },
  );

  it('leaves an element holding a picture alone', () => {
    expect(marked('<div><img alt=""></div>')).toBe(false);
  });

  it('takes the mark off as soon as something is typed', () => {
    const target = element('<h1><br></h1>');
    syncBlankMark(target);
    expect(target.hasAttribute(BLANK_ATTRIBUTE)).toBe(true);

    target.textContent = 'あ';
    syncBlankMark(target);
    expect(target.hasAttribute(BLANK_ATTRIBUTE)).toBe(false);
  });

  it('puts it back when the last character is deleted', () => {
    const target = element('<h1>あ</h1>');
    syncBlankMark(target);
    expect(target.hasAttribute(BLANK_ATTRIBUTE)).toBe(false);

    target.innerHTML = '<br>';
    syncBlankMark(target);
    expect(target.hasAttribute(BLANK_ATTRIBUTE)).toBe(true);
  });
});

describe('clearBlankMark', () => {
  it('takes the mark off whatever the element holds', () => {
    const target = element('<h1></h1>');
    syncBlankMark(target);
    clearBlankMark(target);
    expect(target.hasAttribute(BLANK_ATTRIBUTE)).toBe(false);
  });
});

/**
 * The line the caret stands on. Whether it makes the caret visible is a
 * question about painting, which jsdom has no answer to — it computes no
 * layout and every rectangle it reports is 0. What can be held here is the
 * other half: that the break goes only where it is needed, that it is marked so
 * it can be found again, and that nothing the deck or the user wrote is taken
 * for it.
 */
describe('openCaretLine', () => {
  it('gives an element with nothing in it one line', () => {
    const target = element('<div></div>');
    openCaretLine(target);
    expect(target.querySelectorAll('br')).toHaveLength(1);
  });

  it('marks the break, so the session can find its own again', () => {
    const target = element('<div></div>');
    openCaretLine(target);
    expect(target.querySelector('br')?.hasAttribute(CARET_LINE_ATTRIBUTE)).toBe(true);
    // The prefix serialization strips, so a session caught mid-flight exports
    // a bare <br> rather than an editor attribute (bridge.ts).
    expect(CARET_LINE_ATTRIBUTE.startsWith('data-hse-')).toBe(true);
  });

  it('adds nothing twice', () => {
    const target = element('<div></div>');
    openCaretLine(target);
    openCaretLine(target);
    expect(target.querySelectorAll('br')).toHaveLength(1);
  });

  it('leaves a break already there alone, and does not claim it as its own', () => {
    const target = element('<h1><br></h1>');
    openCaretLine(target);
    expect(target.querySelectorAll('br')).toHaveLength(1);
    expect(target.querySelector('br')?.hasAttribute(CARET_LINE_ATTRIBUTE)).toBe(false);
  });

  it('leaves an element that has words in it alone', () => {
    const target = element('<h1>見出し</h1>');
    openCaretLine(target);
    expect(target.innerHTML).toBe('見出し');
  });

  it('leaves an element holding a picture alone', () => {
    const target = element('<div><img alt=""></div>');
    openCaretLine(target);
    expect(target.querySelector('br')).toBeNull();
  });

  it('keeps the element blank, so the prompt still shows over it', () => {
    const target = element('<div></div>');
    openCaretLine(target);
    syncBlankMark(target);
    expect(target.hasAttribute(BLANK_ATTRIBUTE)).toBe(true);
  });
});

describe('dropCaretLine', () => {
  it('takes back the break it put in, leaving the element as it was', () => {
    const target = element('<div></div>');
    openCaretLine(target);
    dropCaretLine(target);
    expect(target.innerHTML).toBe('');
  });

  it('leaves the break the deck wrote where it is', () => {
    const target = element('<h1><br></h1>');
    openCaretLine(target);
    dropCaretLine(target);
    expect(target.innerHTML).toBe('<br>');
  });

  it('leaves a break with words around it alone, mark or no mark', () => {
    // The session's own node, kept by the browser as the break between two
    // lines the user then typed. It is the user's line now.
    const target = element(`<p>段落<br ${CARET_LINE_ATTRIBUTE}>2 行目</p>`);
    dropCaretLine(target);
    expect(target.querySelectorAll('br')).toHaveLength(1);
  });

  it('leaves a trailing break after text alone', () => {
    const target = element(`<p>段落<br ${CARET_LINE_ATTRIBUTE}></p>`);
    dropCaretLine(target);
    expect(target.querySelectorAll('br')).toHaveLength(1);
  });

  it('leaves an element it never touched alone', () => {
    const target = element('<h1>見出し</h1>');
    dropCaretLine(target);
    expect(target.innerHTML).toBe('見出し');
  });
});

/**
 * jsdom applies no stylesheet and computes no layout, so the only thing that
 * can be asked of the rules is what they say. The declarations below are each
 * load-bearing for one of the two ways the caret went missing, so a change to
 * any of them should be a deliberate one.
 */
describe('placeholderRules', () => {
  const rules = placeholderRules('"テキストを入力"');

  it('paints the prompt on the blank mark', () => {
    expect(rules).toContain(`[${BLANK_ATTRIBUTE}]::before`);
    expect(rules).toContain('content: "テキストを入力"');
  });

  it('asks for the mark alone, so a box that is only selected still gets it', () => {
    // The prompt used to be gated on `contenteditable`, which came for free
    // with a text session. A newly inserted box is selected and not in one, so
    // the guard that keeps the prompt off a deck's own empty elements moved
    // into script — where it can name the one box it means (EditStage).
    const prompt = rules.slice(0, rules.indexOf('::before'));
    expect(prompt).not.toContain('contenteditable');
  });

  it('takes the prompt out of flow so the caret is not pushed past it', () => {
    expect(rules).toContain('position: absolute');
  });

  it('leaves every offset auto, so the prompt keeps its static position', () => {
    expect(rules).not.toMatch(/\b(top|left|right|bottom|inset)\s*:/);
  });

  it('does not position the element itself, which would move a deck that does', () => {
    expect(rules).not.toContain('position: relative');
  });

  it('gives a blank box a floor to stand on, so it can still be clicked', () => {
    // Not decoration. Measured on the real deck, 122 of its 262 text elements
    // went to zero width the moment their text came out, and a box with no
    // area answers `elementFromPoint` with the panel behind it — so the click
    // that should have selected the box selected the panel (issues #104).
    expect(rules).toContain(`[${BLANK_ATTRIBUTE}] {`);
    expect(rules).toContain('min-width');
    expect(rules).toContain('min-height');
  });

  it('gives the caret a colour of its own while the element is blank', () => {
    expect(rules).toContain('caret-color');
  });

  it('colours the caret only where there is one, which is inside a session', () => {
    // The other half of the rule above. A selected box has no caret standing in
    // it, so this declaration keeps the `contenteditable` the prompt gave up.
    const caret = rules.slice(rules.lastIndexOf('}', rules.indexOf('caret-color')));
    expect(caret).toContain(`[contenteditable="true"][${BLANK_ATTRIBUTE}]`);
  });
});
