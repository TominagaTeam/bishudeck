import { describe, expect, it } from 'vitest';

import { createInsertionCleaner, sanitizeInsertedNode } from './paste';

/** Builds the fragment a paste would have inserted, already in a document. */
function inserted(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  const node = host.firstElementChild as HTMLElement;
  sanitizeInsertedNode(node);
  return host;
}

/**
 * The two things actually measured escaping into an exported deck were
 * `class="mso-junk"` and `font-size:99px`.
 */
describe('sanitizeInsertedNode', () => {
  it('drops the classes a word processor brings with it', () => {
    expect(inserted('<span class="mso-junk">A</span>').innerHTML).toBe('<span>A</span>');
  });

  it('drops the source document typography', () => {
    const html = inserted('<span style="font-size:99px;color:red">A</span>').innerHTML;
    expect(html).toBe('<span>A</span>');
  });

  it('keeps emphasis, which is the part the user chose', () => {
    expect(inserted('<b>A</b>').innerHTML).toBe('<b>A</b>');
    const bolded = inserted('<span style="font-weight:700;font-size:99px">A</span>');
    expect(bolded.querySelector('span')?.style.fontWeight).toBe('700');
    expect(bolded.querySelector('span')?.style.fontSize).toBe('');
  });

  it('keeps links and list structure', () => {
    const html = inserted('<ul class="x"><li id="y">A</li></ul>').innerHTML;
    expect(html).toBe('<ul><li>A</li></ul>');
    expect(inserted('<a href="https://example.com" target="_blank">A</a>').innerHTML).toBe(
      '<a href="https://example.com">A</a>',
    );
  });

  // A fragment copied from the editor itself carries uids; two elements under
  // one uid is worse than none, because commands then address both.
  it('drops every data-* attribute, the editor own ones included', () => {
    expect(inserted('<p data-hse-uid="7" data-count="3">A</p>').innerHTML).toBe('<p>A</p>');
  });

  it('removes anything that would run or restyle the deck', () => {
    expect(inserted('<div><script>alert(1)</script><style>p{color:red}</style>A</div>').innerHTML)
      .toBe('<div>A</div>');
    expect(inserted('<script>alert(1)</script>').innerHTML).toBe('');
  });

  it('never unwraps an element, so the pasted text keeps its shape', () => {
    const html = inserted('<div class="a"><p class="b">A</p><p class="c">B</p></div>').innerHTML;
    expect(html).toBe('<div><p>A</p><p>B</p></div>');
  });

  it('leaves no empty style attribute behind', () => {
    expect(inserted('<span style="color:red">A</span>').innerHTML).not.toContain('style');
  });

  it('ignores text nodes, which carry nothing to clean', () => {
    const text = document.createTextNode('A');
    expect(() => sanitizeInsertedNode(text)).not.toThrow();
    expect(text.textContent).toBe('A');
  });
});

/**
 * A text box with a cleaner already watching it, as EditStage sets one up when
 * a session opens.
 *
 * Attached to the real document because the cleaner reads the box live, and a
 * detached tree would still answer — but `MutationObserver` is what feeds it,
 * and driving that is the whole point of testing through this door rather than
 * calling `sanitizeInsertedNode` with a hand-built set.
 */
function openBox(html: string) {
  const box = document.createElement('div');
  box.innerHTML = html;
  document.body.appendChild(box);

  const cleaner = createInsertionCleaner(box);
  // `takeRecords` rather than waiting for the callback: the records are the
  // same ones the observer would deliver, and taking them makes the test
  // synchronous, so a failure points at the cleaning rather than at a timing
  // guess about when jsdom flushes its microtask.
  const observer = new MutationObserver(() => {});
  observer.observe(box, { subtree: true, childList: true, characterData: true });

  return {
    box,
    /**
     * The spans in the box, in document order, so a test can name the one that
     * has just appeared by its position. A selector would be the obvious way
     * and is a trap here: the box is itself a `<div>`, so `box.querySelector(
     * 'div span')` matches a span that is a direct child of the box — the
     * selector is evaluated against the whole document and only then filtered
     * to the box's descendants.
     */
    spans() {
      return Array.from(box.querySelectorAll('span'));
    },
    /** Runs an edit and hands the cleaner what the browser reported for it. */
    edit(mutate: () => void) {
      mutate();
      cleaner.clean(observer.takeRecords());
    },
    /** The same, for an edit the editor's own commands made. */
    accept(mutate: () => void) {
      mutate();
      observer.takeRecords();
      cleaner.accept();
    },
    done() {
      observer.disconnect();
      box.remove();
    },
  };
}

/**
 * The other half of the cleaning: which of the nodes that appear are the
 * browser's own editing, and so keep the typography they were copied with.
 *
 * Chrome splits a line by cloning the run the caret sits in, so ending a 48px
 * line mints `<div><span style="font-size:48px"><br></span></div>` — and
 * scrubbing that as if it were a paste is what "フォントサイズ機能がうまく
 * 追従していません" actually was.
 */
describe('createInsertionCleaner', () => {
  it('keeps a size the box is already carrying — the Enter case', () => {
    const session = openBox('<span style="font-size:48px">A</span>');
    session.edit(() => {
      session.box.insertAdjacentHTML(
        'beforeend',
        '<div><span style="font-size:48px"><br></span></div>',
      );
    });
    expect(session.spans()[1].style.fontSize).toBe('48px');
    session.done();
  });

  it('still drops a size nothing in the box declares — the paste case', () => {
    const session = openBox('<span style="font-size:48px">A</span>');
    session.edit(() => {
      session.box.insertAdjacentHTML('beforeend', '<span style="font-size:99px">B</span>');
    });
    expect(session.box.innerHTML).toContain('<span>B</span>');
    session.done();
  });

  it('carries colour and highlight the same way', () => {
    const session = openBox(
      '<span style="color:rgb(255, 0, 0);background-color:rgb(255, 255, 0)">A</span>',
    );
    session.edit(() => {
      session.box.insertAdjacentHTML(
        'beforeend',
        '<span style="color:rgb(255, 0, 0);background-color:rgb(255, 255, 0)">B</span>' +
          '<span style="color:rgb(0, 0, 255)">C</span>',
      );
    });
    const [, copied, foreign] = session.spans();
    expect(copied.style.color).toBe('rgb(255, 0, 0)');
    expect(copied.style.backgroundColor).toBe('rgb(255, 255, 0)');
    // The other half of the same rule: a colour nothing in the box declares is
    // the source document's, and goes. Both spans arrived in one batch, so
    // "what the box carries" is what tells them apart and nothing else can.
    expect(foreign.hasAttribute('style')).toBe(false);
    session.done();
  });

  it('reads what the same batch took out, so a replaced run still counts', () => {
    // Selecting the whole line and pressing Return: the run carrying the size
    // leaves in the same breath as the empty one carrying it arrives, so the
    // box on its own no longer declares 48px by the time the record lands.
    const session = openBox('<span style="font-size:48px">A</span>');
    session.edit(() => {
      session.box.innerHTML = '<div><span style="font-size:48px"><br></span></div>';
    });
    expect(session.box.querySelector('span')?.style.fontSize).toBe('48px');
    session.done();
  });

  it('takes the addresses off anyway, carried or not', () => {
    // Chrome clones the run whole, uid included, so both halves of a split line
    // come out wearing one uid. Softening the attribute scrub for a carried
    // declaration would be softening the thing that keeps a uid meaning one
    // element (invariant 6).
    const session = openBox('<span style="font-size:48px" data-hse-uid="e7">A</span>');
    session.edit(() => {
      session.box.insertAdjacentHTML(
        'beforeend',
        '<span style="font-size:48px" data-hse-uid="e7">B</span>',
      );
    });
    const added = session.spans()[1];
    expect(added.hasAttribute('data-hse-uid')).toBe(false);
    expect(added.style.fontSize).toBe('48px');
    session.done();
  });

  it('counts what the editor own commands minted as markup the box has', () => {
    // `isFormatting()` is up while a command runs, so EditStage calls `accept`
    // instead of `clean`. What matters is the *next* batch: the span the size
    // command just wrote is now part of what the box declares, so the line the
    // user starts under it keeps that size.
    const session = openBox('<span>A</span>');
    session.accept(() => {
      session.box.insertAdjacentHTML('beforeend', '<span style="font-size:32px">B</span>');
    });
    session.edit(() => {
      session.box.insertAdjacentHTML(
        'beforeend',
        '<div><span style="font-size:32px"><br></span></div>',
      );
    });
    expect(session.spans()[2].style.fontSize).toBe('32px');
    session.done();
  });

  it('leaves the box own placement out of what it carries', () => {
    // A text box copied out of the editor and pasted back in would otherwise
    // arrive holding `position:absolute`, and land on top of its original.
    const session = openBox('<span>A</span>');
    session.box.setAttribute('style', 'position:absolute;left:10px');
    session.edit(() => {
      session.box.insertAdjacentHTML('beforeend', '<div style="position:absolute;left:10px">B</div>');
    });
    expect(session.box.querySelector('div')?.hasAttribute('style')).toBe(false);
    session.done();
  });
});
