// @vitest-environment jsdom
import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SLIDE_ROOT_ATTRIBUTE } from '../core/document/compose';
import { clearHistory, setActiveStage, useHistory } from '../core/commands/engine';
import { setTextSession, snapshotSessionRange } from '../core/editing/richText';
import { StageBridge } from '../stage/bridge';
import { TextFormatControls } from './TextFormatControls';

/**
 * The 太さ menu, and what it may and may not swallow.
 *
 * It was the one control in this panel that could not be opened with the mouse:
 * a `mousedown` handler calling `preventDefault` had been added to match the
 * buttons beside it, and a `<select>`'s mousedown default *is* showing the
 * popup. The keyboard path was never blocked, which is why the menu still
 * applied a weight when walked with Tab and the arrows — so the tests below use
 * `change`, the event both paths arrive on, for what the control does, and read
 * the press itself only for what it is allowed to cancel.
 *
 * Mounted for real rather than asserted against the props, so the pair below
 * says something about the DOM the browser sees: the press that opens the menu
 * survives, the press that would take focus off the text does not.
 */

let host: HTMLDivElement;
let root: Root;
let heading: HTMLElement;
let uid: string;
/** The range each `execCommand` call saw, which is the restore under test. */
let executed: { command: string; text: string }[];

/** What the computed read hands the panel for an untouched deck heading. */
const STYLES = {
  'font-weight': '400',
  'font-family': "'Noto Sans', sans-serif",
  'font-size': '28px',
  color: 'rgb(20, 22, 26)',
  'text-align': 'start',
  direction: 'ltr',
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = `<section ${SLIDE_ROOT_ATTRIBUTE}><h2>今期のハイライト</h2></section>`;
  heading = document.querySelector('h2') as HTMLElement;

  setActiveStage(new StageBridge(document, () => {}));
  uid = heading.getAttribute('data-hse-uid') as string;
  clearHistory();

  executed = [];
  (document as Document & { execCommand?: unknown }).execCommand = vi.fn((command: string) => {
    // `styleWithCSS` is a mode switch bracketed round the colour commands so
    // they answer with a span instead of `<font color>` (core/editing/
    // richText.ts). It acts on no selection, so recording it here would say
    // nothing about the range these tests are watching.
    if (command === 'styleWithCSS') return true;
    const selection = window.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    executed.push({ command, text: range ? range.toString() : '' });
    return true;
  });

  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setTextSession(null);
  setActiveStage(null);
  clearHistory();
});

const openSession = () => act(() => setTextSession({ uid }));

const render = () =>
  act(() => root.render(h(TextFormatControls, { uid, styles: { ...STYLES } })));

/** The 太さ menu, found the way the row ties its label to it (`Field`). */
const weightMenu = (): HTMLSelectElement => {
  const label = Array.from(host.querySelectorAll('label')).find(
    (candidate) => candidate.textContent === '太さ',
  );
  return document.getElementById(label?.getAttribute('for') as string) as HTMLSelectElement;
};

const pickWeight = (value: string) =>
  act(() => {
    const menu = weightMenu();
    menu.value = value;
    menu.dispatchEvent(new window.Event('change', { bubbles: true }));
  });

/** Returns whether the press was cancelled — i.e. whether the default is gone. */
const press = (element: Element): boolean => {
  let cancelled = false;
  act(() => {
    cancelled = !element.dispatchEvent(
      new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    );
  });
  return cancelled;
};

function selectChars(from: number, to: number): void {
  const range = document.createRange();
  range.setStart(heading.firstChild as Node, from);
  range.setEnd(heading.firstChild as Node, to);
  const selection = window.getSelection() as Selection;
  selection.removeAllRanges();
  selection.addRange(range);
}

describe('太さ — what the press may cancel', () => {
  // The reported symptom. A cancelled mousedown is a `<select>` that never
  // shows its list, and nothing above the event tells the two apart.
  it('leaves the press that opens the list alone', () => {
    openSession();
    render();
    expect(press(weightMenu())).toBe(false);
  });

  // The other half, and the reason the call was added in the first place: a
  // button's mousedown defaults to moving focus, which is what costs the frame
  // its selection. Pinned alongside so that removing it from the select is not
  // read as licence to remove it from the buttons.
  it('still cancels the press on the buttons beside it', () => {
    openSession();
    render();
    expect(press(host.querySelector('.format-button.bold') as Element)).toBe(true);
    expect(press(host.querySelector('.format-button.italic') as Element)).toBe(true);
  });
});

describe('太さ — what picking one does', () => {
  it('writes the weight onto the element as one undo step', () => {
    render();
    pickWeight('700');

    expect(heading.style.getPropertyValue('font-weight')).toBe('700');
    expect(useHistory.getState().undoStack).toHaveLength(1);
  });

  // Reversed. It used to write the weight onto the element even with a range
  // open — the mechanism's excuse, not the user's: they had
  // selected two characters and watched the whole heading go bold. It now takes
  // the same scope B does, through the wrapper `setFontWeight` writes.
  it('writes it onto the range when one is open', () => {
    openSession();
    render();
    selectChars(0, 2);
    pickWeight('700');

    expect(heading.style.getPropertyValue('font-weight')).toBe('');
    expect(heading.querySelector('span')?.style.fontWeight).toBe('700');
    expect(heading.textContent).toBe('今期のハイライト');
  });

  // A caret is not a range, and `setFontWeight` deliberately does nothing at
  // one: there is no pending-style command to arm for "the weight of what I
  // type next". Routed by the session alone this control would be dead there,
  // so the box is what it falls back to.
  it('writes it onto the element when the session has only a caret', () => {
    openSession();
    render();
    selectChars(1, 1);
    pickWeight('700');

    expect(heading.style.getPropertyValue('font-weight')).toBe('700');
    expect(heading.innerHTML).toBe('今期のハイライト');
  });

  // What the cancelled press was protecting, tested without it. Focus really
  // does leave the frame now, and the selection with it — the range survives
  // because it was snapshotted on the way in and is put back before the next
  // command runs, which is the same arrangement the font menu has always run on.
  it('leaves the range for the next command that wants one', () => {
    openSession();
    render();
    selectChars(0, 2);
    // EditStage's capture listener, on a pointerdown over the panel.
    snapshotSessionRange();
    pickWeight('700');
    // The menu took focus; WebKit drops the frame's selection when it goes.
    window.getSelection()?.removeAllRanges();

    act(() => {
      (host.querySelector('.color-apply') as HTMLElement).click();
    });

    expect(executed).toEqual([{ command: 'foreColor', text: '今期' }]);
  });
});

/**
 * The other two controls that write a *value*, and the rule they now share.
 *
 * They live in this file because the harness is here and the rule is the same
 * one 太さ is tested against above: a session alone is not enough, there has to
 * be a range. `setFontSize` and `setFontFamily` refuse a bare caret for the
 * reason `hasSessionRange` documents — `execCommand` mints no element there,
 * only a pending style, and the number field takes focus back before anything
 * can be typed into it, leaving a `<font>` in the slide for nothing.
 *
 * Routed by the session alone, both were therefore *dead* at a caret: click a
 * box, type a size, nothing happens — which is the commonest gesture there is,
 * and the panel's own hint promised otherwise.
 */
/** The panel's own sentinel for "no single answer" (TextFormatControls). */
const MIXED_SENTINEL = '*mixed*';

describe('サイズと書体 — 範囲が無いときは箱に効く', () => {
  const sizeField = (): HTMLInputElement => {
    const label = Array.from(host.querySelectorAll('label')).find(
      (candidate) => candidate.textContent === 'サイズ',
    );
    return document.getElementById(label?.getAttribute('for') as string) as HTMLInputElement;
  };

  /**
   * Committed the way the field commits: typed, then a `change`.
   *
   * The value goes in through the prototype's own setter because React tracks
   * what it last wrote and drops an `input` whose value it believes it already
   * knows — the same reason `inspectorLiveNumber.test.ts` reaches for it.
   */
  const typeSize = (value: string) =>
    act(() => {
      const field = sizeField();
      const setValue = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setValue.call(field, value);
      field.dispatchEvent(new window.Event('input', { bubbles: true }));
      field.dispatchEvent(new window.Event('change', { bubbles: true }));
    });

  const fontMenu = (): HTMLSelectElement => {
    const label = Array.from(host.querySelectorAll('label')).find(
      (candidate) => candidate.textContent === 'フォント',
    );
    return document.getElementById(label?.getAttribute('for') as string) as HTMLSelectElement;
  };

  it('sizes the box when the session has only a caret', () => {
    openSession();
    render();
    selectChars(1, 1);
    typeSize('48');

    expect(heading.style.getPropertyValue('font-size')).toBe('48px');
    // Nothing was wrapped: the run is the box's own text, untouched.
    expect(heading.innerHTML).toBe('今期のハイライト');
  });

  it('sizes the range when one is open', () => {
    openSession();
    render();
    selectChars(0, 2);
    typeSize('48');

    // The element keeps whatever it had; the range is what moved.
    expect(heading.style.getPropertyValue('font-size')).toBe('');
    expect(executed.map((call) => call.command)).toContain('fontSize');
  });

  it('sets the family on the box when the session has only a caret', () => {
    openSession();
    render();
    selectChars(1, 1);
    // Whatever the catalog actually offered here rather than a name written
    // out: the list is measured against the machine (shared/fonts.ts) and jsdom
    // has no canvas to measure with, so naming a face would test the runner's
    // font situation instead of this branch.
    const offered = Array.from(fontMenu().options)
      .map((option) => option.value)
      .filter((value) => value !== '' && value !== MIXED_SENTINEL);
    expect(offered.length).toBeGreaterThan(0);
    const stack = offered[offered.length - 1];

    act(() => {
      const menu = fontMenu();
      menu.value = stack;
      menu.dispatchEvent(new window.Event('change', { bubbles: true }));
    });

    // Quotes normalised: CSSOM reads a stack back with its own quoting, so the
    // comparison is on the names rather than on the punctuation between them.
    const unquoted = (value: string) => value.replace(/['"]/g, '');
    expect(unquoted(heading.style.getPropertyValue('font-family'))).toBe(unquoted(stack));
    expect(heading.innerHTML).toBe('今期のハイライト');
  });

  // Out of a session the fields have always written the element. The rule added
  // here must not have changed that — it only widened *when* the element is the
  // target, never narrowed it.
  it('still sizes the box with no session at all', () => {
    render();
    typeSize('48');

    expect(heading.style.getPropertyValue('font-size')).toBe('48px');
    expect(useHistory.getState().canUndo).toBe(true);
  });
});
