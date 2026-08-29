// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TextSelectionController, holdTextFocus, placeCaret } from './textSelection';

/**
 * The host draws the selection because the frame cannot be asked to
 * (issues #17), so what is under test is the arithmetic of press → anchor,
 * move → focus, and the press-count run.
 *
 * `caretRangeFromPoint` does not exist in jsdom — nor would a layout-free DOM
 * have anything to answer with — so the resolver is injected: x is a character
 * offset, and a negative y means "the pointer left the element".
 */
const TEXT = 'Claude Code の基礎講座';

let host: HTMLElement;
let elsewhere: HTMLElement;
let selection: Selection;

function caret(node: Node, offset: number): Range {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  return range;
}

function resolve(x: number, y: number): Range | null {
  if (y < 0) return caret(elsewhere.firstChild as Node, 0);
  return caret(host.firstChild as Node, Math.max(0, Math.min(TEXT.length, Math.round(x))));
}

function controller(): TextSelectionController {
  return new TextSelectionController(host, resolve);
}

/** What the selection holds, as the pair of offsets a user would point at. */
function span(): [number, number] {
  return [selection.anchorOffset, selection.focusOffset];
}

beforeEach(() => {
  document.body.innerHTML = `<h1 id="host">${TEXT}</h1><p id="elsewhere">別の要素</p>`;
  host = document.getElementById('host') as HTMLElement;
  elsewhere = document.getElementById('elsewhere') as HTMLElement;
  selection = window.getSelection() as Selection;
  selection.removeAllRanges();
});

describe('pointer selection', () => {
  it('takes the text between where the press landed and where the drag went', () => {
    const selecting = controller();
    selecting.begin(2, 10, { at: 0, shift: false });
    selecting.extendTo(9, 10);
    selecting.end();

    expect(span()).toEqual([2, 9]);
    expect(selection.toString()).toBe(TEXT.slice(2, 9));
  });

  // The bug this whole module exists for: the browser drags a range that is
  // pressed on instead of starting a new one, and a scripting-disabled frame
  // cannot be told not to.
  it('starts a new selection from a press inside the existing one', () => {
    const selecting = controller();
    selecting.begin(0, 10, { at: 0, shift: false });
    selecting.extendTo(12, 10);
    selecting.end();
    expect(span()).toEqual([0, 12]);

    selecting.begin(4, 10, { at: 1000, shift: false });
    selecting.extendTo(7, 10);
    selecting.end();

    expect(span()).toEqual([4, 7]);
  });

  it('holds the last position inside when the drag leaves the element', () => {
    const selecting = controller();
    selecting.begin(2, 10, { at: 0, shift: false });
    selecting.extendTo(6, 10);
    selecting.extendTo(9, -1);

    expect(span()).toEqual([2, 6]);
    expect(host.contains(selection.focusNode)).toBe(true);
  });

  it('ignores movement when no press started it', () => {
    const selecting = controller();
    selecting.extendTo(6, 10);

    expect(selection.rangeCount).toBe(0);
  });
});

describe('repeat presses', () => {
  it('takes the word on the second press', () => {
    const modify = vi.fn();
    (selection as Selection & { modify?: unknown }).modify = modify;

    const selecting = controller();
    selecting.begin(3, 10, { at: 0, shift: false });
    expect(modify).not.toHaveBeenCalled();

    selecting.begin(3, 10, { at: 120, shift: false });

    expect(modify.mock.calls).toEqual([
      ['move', 'backward', 'word'],
      ['extend', 'forward', 'word'],
    ]);
  });

  it('takes the whole element on the third', () => {
    const selecting = controller();
    selecting.begin(3, 10, { at: 0, shift: false });
    selecting.begin(3, 10, { at: 120, shift: false });
    selecting.begin(3, 10, { at: 240, shift: false });

    expect(selection.toString()).toBe(TEXT);
  });

  it('does not count a press as a repeat once the pointer has moved away', () => {
    const modify = vi.fn();
    (selection as Selection & { modify?: unknown }).modify = modify;

    const selecting = controller();
    selecting.begin(3, 10, { at: 0, shift: false });
    selecting.begin(9, 10, { at: 120, shift: false });

    expect(modify).not.toHaveBeenCalled();
    expect(span()).toEqual([9, 9]);
  });

  it('does not count a press as a repeat after the run has timed out', () => {
    const modify = vi.fn();
    (selection as Selection & { modify?: unknown }).modify = modify;

    const selecting = controller();
    selecting.begin(3, 10, { at: 0, shift: false });
    selecting.begin(3, 10, { at: 900, shift: false });

    expect(modify).not.toHaveBeenCalled();
  });
});

describe('shift', () => {
  it('moves the far end and leaves the anchor where it was', () => {
    const selecting = controller();
    selecting.begin(2, 10, { at: 0, shift: false });
    selecting.extendTo(6, 10);
    selecting.end();

    selecting.begin(11, 10, { at: 2000, shift: true });

    expect(span()).toEqual([2, 11]);
  });

  it('extends the selection that is already there when the session had one', () => {
    const range = document.createRange();
    range.setStart(host.firstChild as Node, 7);
    range.setEnd(host.firstChild as Node, 11);
    selection.removeAllRanges();
    selection.addRange(range);

    const selecting = controller();
    selecting.begin(2, 10, { at: 0, shift: true });

    expect(span()).toEqual([7, 2]);
  });
});

describe('placeCaret', () => {
  /**
   * The point only resolves through `caretRangeFromPoint`, which jsdom has no
   * layout to answer with. Standing one in lets the test see the branch the
   * real app takes; without it every call falls through to the end-of-text
   * fallback and the two cases below would be the same test twice.
   */
  // Through a record, because `lib.dom` declares `caretRangeFromPoint` as a
  // required member of `Document` — intersecting an optional one back onto it
  // does not make `delete` legal again.
  const asRecord = document as unknown as Record<string, unknown>;

  function stubPointResolution(offset: number): void {
    asRecord.caretRangeFromPoint = () => caret(host.firstChild as Node, offset);
  }

  afterEach(() => {
    delete asRecord.caretRangeFromPoint;
  });

  it('puts the caret where the pointer was and selects nothing', () => {
    const modify = vi.fn();
    (selection as Selection & { modify?: unknown }).modify = modify;
    stubPointResolution(4);

    placeCaret(host, { x: 0, y: 0 });

    // Selecting the word here is what made the next keystroke destructive
    // (issues #25); it belongs to the second press of a run instead.
    expect(modify).not.toHaveBeenCalled();
    expect(selection.isCollapsed).toBe(true);
    expect(selection.anchorOffset).toBe(4);
  });

  it('falls back to the end of the text when the point resolves to nothing', () => {
    placeCaret(host, { x: 0, y: 0 });

    expect(selection.isCollapsed).toBe(true);
    expect(selection.toString()).toBe('');
  });

  /**
   * `caretRangeFromPoint` answers for the document, not for the element that
   * asked — a hit on the box's padding or between two lines can resolve to a
   * neighbour. Putting the caret there points it at markup that is not
   * `contenteditable`: nothing is painted and nothing typed lands, which is the
   * "no caret on double-click" the user reported.
   */
  it('ignores a point that resolves outside the element being edited', () => {
    asRecord.caretRangeFromPoint = () => caret(elsewhere.firstChild as Node, 1);

    placeCaret(host, { x: 0, y: 0 });

    expect(host.contains(selection.anchorNode)).toBe(true);
    expect(selection.isCollapsed).toBe(true);
  });
});

describe('holdTextFocus', () => {
  /**
   * The stage frame is `srcdoc` under `sandbox="allow-same-origin"`, so the
   * host reaches into it; an about:blank frame is the same arrangement.
   */
  function stageFrame(): { frame: HTMLIFrameElement; element: HTMLElement } {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const doc = frame.contentDocument as Document;
    doc.body.innerHTML = '<p contenteditable="true">段落</p>';
    return { frame, element: doc.querySelector('p') as HTMLElement };
  }

  it('takes focus back from the host frame-first and leaves it on the element', () => {
    const { frame, element } = stageFrame();
    const order: string[] = [];
    vi.spyOn(frame, 'focus').mockImplementation(() => void order.push('frame'));
    vi.spyOn(frame.contentWindow as Window, 'focus').mockImplementation(() =>
      void order.push('window'),
    );
    vi.spyOn(element, 'focus').mockImplementation(() => void order.push('element'));

    holdTextFocus(element);

    // Outside in. The element last, because focusing either of the two outer
    // ones resets the frame document's own focused element to its body.
    expect(order).toEqual(['frame', 'window', 'element']);
  });

  // A parsed document has no window at all, which is the shape of every case
  // where the two outer steps are unavailable: the element still gets focused.
  it('still focuses the element when there is no window to focus', () => {
    const detached = new DOMParser().parseFromString('<p>段落</p>', 'text/html');
    const element = detached.querySelector('p') as HTMLElement;
    const focus = vi.fn();
    element.focus = focus;

    holdTextFocus(element);

    expect(focus).toHaveBeenCalled();
  });
});
