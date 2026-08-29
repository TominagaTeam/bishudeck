import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LiveNumberInput } from './LiveNumberInput';

/**
 * The one number field the inspector has — 文字サイズ, 余白, 角丸, 枠線の太さ and
 * 位置とサイズ are all this component (issues #38).
 *
 * What has to be right is *when* a value leaves the box and what the box shows
 * meanwhile, and neither is a judgement that can be pulled out into a pure
 * function — so it is mounted for real, the way `inspectorField.test.ts` is.
 *
 * The events below are the ones a browser actually sends, measured in Chrome
 * against the running app: typing a digit fires `input` alone, and a press on
 * ▲ or ↑ fires `input` and `change` together. That pair is the whole rule this
 * component runs on, so the tests send it rather than calling the component's
 * internals.
 */

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (node: React.ReactNode) => act(() => root.render(node));
const box = () => host.querySelector('input')!;

/**
 * Puts text in the box the way the engine does. React tracks the last value it
 * wrote on the node itself and would otherwise decide nothing had changed.
 */
const setBoxValue = (text: string) => {
  const setValue = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )!.set!;
  setValue.call(box(), text);
};

/** One keystroke: `input` and nothing else. */
const type = (text: string) =>
  act(() => {
    setBoxValue(text);
    box().dispatchEvent(new window.Event('input', { bubbles: true }));
  });

/** One press on ▲ / ↑: the engine steps the value and commits it in one go. */
const step = (text: string) =>
  act(() => {
    setBoxValue(text);
    box().dispatchEvent(new window.Event('input', { bubbles: true }));
    box().dispatchEvent(new window.Event('change', { bubbles: true }));
  });

const enter = () =>
  act(() => {
    box().dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
  });

describe('LiveNumberInput — when the value leaves the box', () => {
  it('applies nothing while the number is being typed', () => {
    const applied: number[] = [];
    render(h(LiveNumberInput, { value: 0, max: 1000, onApply: (v: number) => applied.push(v) }));

    type('1');
    type('12');
    type('120');
    expect(applied).toEqual([]);
  });

  it('applies once on Enter', () => {
    const applied: number[] = [];
    render(h(LiveNumberInput, { value: 0, max: 1000, onApply: (v: number) => applied.push(v) }));

    type('1');
    type('12');
    type('120');
    enter();
    expect(applied).toEqual([120]);
  });

  it('applies once when focus leaves', () => {
    const applied: number[] = [];
    render(h(LiveNumberInput, { value: 0, max: 1000, onApply: (v: number) => applied.push(v) }));

    act(() => box().focus());
    type('48');
    act(() => box().blur());
    expect(applied).toEqual([48]);
  });

  // The answer to what the every-keystroke field was for: a size still has a
  // control that shows its effect as it moves. This is the one that has to stay
  // immediate, and it is the reason typing can afford not to be.
  it('applies a step from the spinner the moment it is pressed', () => {
    const applied: number[] = [];
    render(h(LiveNumberInput, { value: 28, max: 200, onApply: (v: number) => applied.push(v) }));

    step('29');
    step('30');
    expect(applied).toEqual([29, 30]);
  });

  // Enter, blur and the engine's own `change` can all arrive over one edit, and
  // each is now its own undo step — so two of them firing would record the same
  // number twice.
  it('applies nothing a second time when Enter is followed by blur', () => {
    const applied: number[] = [];
    render(h(LiveNumberInput, { value: 10, max: 1000, onApply: (v: number) => applied.push(v) }));

    act(() => box().focus());
    type('64');
    enter();
    act(() => box().blur());
    expect(applied).toEqual([64]);
  });

  // Emptying the box mid-edit is not a request to put the element at 0
  // (issues #10), and neither is what type="number" reports for letters.
  it('applies nothing for a draft that is not a number', () => {
    const applied: number[] = [];
    render(h(LiveNumberInput, { value: 24, max: 200, onApply: (v: number) => applied.push(v) }));

    type('');
    enter();
    type('abc');
    enter();
    expect(applied).toEqual([]);
    // `type="number"` hands letters back as the empty string, which is why the
    // two cases are the same one and why neither may be read as a zero. The box
    // goes back to the element rather than staying blank.
    expect(box().value).toBe('24');
  });
});

describe('LiveNumberInput — the bounds', () => {
  // The point of waiting for Enter. Typing 100 into a field that floors at 8
  // used to walk the element through 8 (for "1"), then 10, before landing —
  // three commands and two visible wrong sizes for one number.
  it('clamps once, at the commit, not on the way through', () => {
    const applied: number[] = [];
    render(
      h(LiveNumberInput, { value: 28, min: 8, max: 200, onApply: (v: number) => applied.push(v) }),
    );

    type('1');
    type('10');
    type('100');
    enter();
    expect(applied).toEqual([100]);
  });

  it('keeps the value inside the bounds it was given', () => {
    const applied: number[] = [];
    render(
      h(LiveNumberInput, { value: 8, min: 8, max: 200, onApply: (v: number) => applied.push(v) }),
    );

    type('400');
    enter();
    type('2');
    enter();
    expect(applied).toEqual([200, 8]);
  });

  // A clamped number must not sit in the box as a figure the element does not
  // have, whether or not the caller's own state comes back changed.
  it('shows what it applied rather than what was typed', () => {
    render(h(LiveNumberInput, { value: 8, min: 8, max: 200, onApply: () => {} }));

    act(() => box().focus());
    type('400');
    enter();
    expect(box().value).toBe('200');
  });

  // X, Y and 回転 have no bounds to give: an element may sit off the slide, and
  // a negative angle is a rotation the other way.
  it('lets a number through untouched when no bounds were given', () => {
    const applied: number[] = [];
    render(h(LiveNumberInput, { value: 0, onApply: (v: number) => applied.push(v) }));

    type('-240');
    enter();
    expect(applied).toEqual([-240]);
  });

  it('rounds to whole units, unless the caller says the value carries fractions', () => {
    const whole: number[] = [];
    render(h(LiveNumberInput, { value: 0, max: 400, onApply: (v: number) => whole.push(v) }));
    type('22.5');
    enter();

    act(() => root.unmount());
    root = createRoot(host);
    const fractional: number[] = [];
    render(
      h(LiveNumberInput, {
        value: 0,
        whole: false,
        onApply: (v: number) => fractional.push(v),
      }),
    );
    type('22.5');
    enter();

    expect(whole).toEqual([23]);
    expect(fractional).toEqual([22.5]);
  });
});

/**
 * What the box shows while somebody else is changing the value under it.
 *
 * Two things move it now: the element, which does not always land on the number
 * it was handed — a content-box element told `width: 150px` reports its padding
 * back on top — and, for 文字サイズ, the caret, which re-reads five times a
 * second as it moves through text of different sizes. Either arriving mid-edit
 * would eat the digit being typed.
 */
describe('LiveNumberInput — whose text is in the box', () => {
  const mount = (value: number | null) =>
    render(h(LiveNumberInput, { value, max: 1000, onApply: () => {} }));

  it('holds the draft against an incoming value', () => {
    mount(100);
    act(() => box().focus());
    type('150');

    mount(190);
    expect(box().value).toBe('150');
  });

  // The draft is what is held, not the focus: a field that has been Entered has
  // no draft left, so it follows the caret again without the user having to
  // click away first.
  it('follows again once the draft has been committed, focus or no focus', () => {
    mount(100);
    act(() => box().focus());
    type('150');
    enter();

    mount(64);
    expect(document.activeElement).toBe(box());
    expect(box().value).toBe('64');
  });

  it('follows the element while the box is somebody else’s', () => {
    mount(100);
    mount(190);
    expect(box().value).toBe('190');
  });

  // A range covering two sizes has no number to show, and naming one of them
  // would invite the user to leave it alone believing the whole selection has it.
  it('goes empty when the caller has no single number', () => {
    mount(64);
    mount(null);
    expect(box().value).toBe('');
  });
});

/**
 * The last call before the thing a number was aimed at disappears.
 *
 * 文字サイズ writes to the range inside a text session, and the click on the
 * canvas that takes focus off the box is the same click that closes that
 * session — from a capture-phase `pointerdown`, so the session is gone before
 * `blur` fires. Waiting for blur would apply the number to nothing, silently.
 */
describe('LiveNumberInput — flushing before the target goes', () => {
  it('applies the draft when the caller announces the loss', () => {
    const applied: number[] = [];
    let announce = () => {};
    render(
      h(LiveNumberInput, {
        value: 28,
        max: 200,
        flushOn: (flush: () => void) => {
          announce = flush;
          return () => {};
        },
        onApply: (v: number) => applied.push(v),
      }),
    );

    act(() => box().focus());
    type('48');
    act(() => announce());
    expect(applied).toEqual([48]);
  });

  // It commits from somewhere the user is not looking, so it must not drag them
  // back into the field — and it must not then apply the same number again when
  // the blur it did not cause finally arrives.
  it('leaves focus alone and does not apply twice', () => {
    const applied: number[] = [];
    let announce = () => {};
    const elsewhere = document.createElement('input');
    document.body.append(elsewhere);
    render(
      h(LiveNumberInput, {
        value: 28,
        max: 200,
        flushOn: (flush: () => void) => {
          announce = flush;
          return () => {};
        },
        // The range writers focus the frame on their way through
        // `prepareSelection`, which is what the field guards against by taking
        // focus back — but only when it had it.
        onApply: (v: number) => {
          applied.push(v);
          elsewhere.focus();
        },
      }),
    );

    act(() => box().focus());
    type('48');
    act(() => box().blur());
    act(() => announce());

    expect(applied).toEqual([48]);
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('takes the listener off when it goes away', () => {
    let removed = false;
    render(
      h(LiveNumberInput, {
        value: 28,
        flushOn: () => () => {
          removed = true;
        },
        onApply: () => {},
      }),
    );

    act(() => root.unmount());
    root = createRoot(host);
    expect(removed).toBe(true);
  });
});
