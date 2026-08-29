// @vitest-environment jsdom
import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SLIDE_ROOT_ATTRIBUTE } from '../core/document/compose';
import { clearHistory, setActiveStage } from '../core/commands/engine';
import { setTextSession, useCaretStyle } from '../core/editing/richText';
import { matchFontStack } from '../shared/fonts';
import { StageBridge } from '../stage/bridge';
import { TextFormatControls } from './TextFormatControls';

/**
 * サイズ / フォント / 太さ — the three fields that show a *value* rather than a
 * yes/no, and what they are showing it about.
 *
 * They used to be seeded once per element from the box's computed style and
 * then sat still, because a value applied to a range leaves that computed style
 * untouched and re-reading it would snap the field back. Measured in the
 * running app, the cost of sitting still was worse than the snapping: a heading
 * with one word blown up to 200px still read 200 with the caret back among the
 * 64px text, so the next number typed there resized the wrong run.
 *
 * What they read inside a session is `useCaretStyle`, filled by the stage's
 * poll from the elements that own the text under the caret. The poll and the
 * reading are covered where they live (core/editing/richText.test.ts); what is
 * tested here is the panel's half — which of the two sources each field takes,
 * and what it shows when the answer is "more than one value".
 */

let host: HTMLDivElement;
let root: Root;
let heading: HTMLElement;
let uid: string;
/** The `execCommand` calls the panel caused, which is how a range edit shows up
 *  in jsdom — the engine that would answer them is not there. */
let executed: string[];

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
    // `styleWithCSS` is a mode switch bracketed round some of the commands and
    // acts on no selection, so recording it would say nothing.
    if (command !== 'styleWithCSS') executed.push(command);
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

const render = (styles: Record<string, string> = STYLES) =>
  act(() => root.render(h(TextFormatControls, { uid, styles: { ...styles } })));

const openSession = () => act(() => setTextSession({ uid }));

/** What the stage's poll would have published for where the caret is. */
const atCaret = (style: {
  fontSize: number | null;
  fontFamily: string | null;
  fontWeight: number | null;
}) => act(() => useCaretStyle.setState(style, true));

/** A control, found the way the row ties its label to it (`Field`). */
const control = (label: string): HTMLInputElement & HTMLSelectElement => {
  const row = Array.from(host.querySelectorAll('label')).find(
    (candidate) => candidate.textContent === label,
  );
  return document.getElementById(row?.getAttribute('for') as string) as HTMLInputElement &
    HTMLSelectElement;
};

/** Whether the control is showing the reading for "no single value".
 *  Asked of the option rather than of `value`, because what matters is that the
 *  sentinel is not something the user can pick. */
const showsMixed = (select: HTMLSelectElement): boolean => {
  const shown = select.selectedOptions[0];
  return Boolean(shown?.disabled && shown.hidden);
};

/** The stack the panel writes for a family, which is the app's own, not the
 *  deck's — `matchFontStack` maps a computed family onto the menu's entry. */
const stackFor = (family: string) => matchFontStack(family) ?? '';

const size = () => control('サイズ');
const font = () => control('フォント');
const weight = () => control('太さ');

describe('the value fields — outside a session', () => {
  it('show the element, because the element is what they will write to', () => {
    render();
    expect(size().value).toBe('28');
    expect(font().value).toBe(stackFor('Noto Sans'));
    expect(weight().value).toBe('400');
  });

  // The read lands one render behind the selection (Inspector fills it in an
  // effect), and blanking the fields for that frame would flicker on every
  // click. The previous element's values stand until the real ones arrive.
  it('keep what they had while the computed read is still empty', () => {
    render();
    render({});
    expect(size().value).toBe('28');
    expect(font().value).toBe(stackFor('Noto Sans'));
  });

  // The ref that used to enforce "once per element" is gone: outside a session
  // every write goes to the element, so what is read back is what was written.
  it('follow a fresh reading of the same element', () => {
    render();
    render({ ...STYLES, 'font-size': '64px', 'font-weight': '700' });
    expect(size().value).toBe('64');
    expect(weight().value).toBe('700');
  });

  // `getComputedStyle` answers with the keyword a deck wrote as readily as with
  // a number, and a menu of 300–900 shows its first option for anything it does
  // not recognise (`normalizeWeight`).
  it('read the keyword spellings of a weight as the number', () => {
    render({ ...STYLES, 'font-weight': 'bold' });
    expect(weight().value).toBe('700');
  });
});

describe('the value fields — inside a session', () => {
  it('show the caret rather than the box', () => {
    openSession();
    render();
    atCaret({ fontSize: 200, fontFamily: 'Georgia, serif', fontWeight: 700 });

    expect(size().value).toBe('200');
    expect(font().value).toBe(stackFor('Georgia'));
    expect(weight().value).toBe('700');
  });

  it('change as the caret moves between two runs', () => {
    openSession();
    render();
    atCaret({ fontSize: 200, fontFamily: null, fontWeight: null });
    expect(size().value).toBe('200');

    atCaret({ fontSize: 64, fontFamily: null, fontWeight: null });
    expect(size().value).toBe('64');
  });

  // Naming one of two values would invite the user to leave it alone believing
  // the whole selection already has it.
  it('go empty when the selection carries more than one value', () => {
    openSession();
    render();
    atCaret({ fontSize: null, fontFamily: null, fontWeight: null });

    expect(size().value).toBe('');
    expect(showsMixed(weight())).toBe(true);
    expect(showsMixed(font())).toBe(true);
  });

  // Blank because there is no *option* to select, not because the empty string
  // is selected: 指定なし is a font this panel can write, and picking it would
  // strip the family off the run. The reading is disabled and hidden.
  it('does not offer 混在 as something to pick', () => {
    openSession();
    render();
    atCaret({ fontSize: null, fontFamily: null, fontWeight: null });

    const mixed = Array.from(font().options).find((option) => option.disabled);
    expect(mixed?.hidden).toBe(true);
    expect(font().selectedOptions[0]).toBe(mixed);
  });

  // The three are decided separately, so a run at one size in two weights still
  // shows its size.
  it('blank only the field that has no answer', () => {
    openSession();
    render();
    atCaret({ fontSize: 64, fontFamily: "'Noto Sans', sans-serif", fontWeight: null });

    expect(size().value).toBe('64');
    expect(font().value).toBe(stackFor('Noto Sans'));
    expect(showsMixed(weight())).toBe(true);
  });

  // A variable face can compute to a weight the menu does not offer. Showing a
  // blank for it would be indistinguishable from 混在.
  it('lists a weight the menu does not stock rather than showing nothing', () => {
    openSession();
    render();
    atCaret({ fontSize: null, fontFamily: null, fontWeight: 350 });

    expect(weight().value).toBe('350');
    expect(weight().selectedOptions[0]?.disabled).toBe(false);
  });

  // The session ends and the caret goes with it; the fields have to fall back
  // to the box rather than keeping the last thing the caret said.
  it('fall back to the element when the session closes', () => {
    openSession();
    render();
    atCaret({ fontSize: 200, fontFamily: null, fontWeight: 900 });
    act(() => setTextSession(null));

    expect(size().value).toBe('28');
    expect(weight().value).toBe('400');
  });
});

/**
 * The draft in サイズ when the thing it was aimed at is about to disappear.
 *
 * The click on the canvas that takes focus off the box is the same click that
 * closes the session, and it closes it from a capture-phase `pointerdown` —
 * long before the box's own `blur`. Waiting for that blur would apply the
 * number to nothing.
 */
describe('サイズ — the draft and the end of the session', () => {
  const selectChars = (from: number, to: number) => {
    const range = document.createRange();
    range.setStart(heading.firstChild as Node, from);
    range.setEnd(heading.firstChild as Node, to);
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);
  };

  /** One keystroke in the box: `input`, and nothing that commits. */
  const typeSize = (text: string) =>
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setValue.call(size(), text);
      size().dispatchEvent(new window.Event('input', { bubbles: true }));
    });

  it('applies it to the range the session is closing on', () => {
    openSession();
    render();
    selectChars(0, 2);
    typeSize('48');
    expect(executed).toEqual([]);

    act(() => setTextSession(null));
    expect(executed).toEqual(['fontSize']);
  });

  it('leaves an untouched field alone when the session ends', () => {
    openSession();
    render();
    selectChars(0, 2);

    act(() => setTextSession(null));
    expect(executed).toEqual([]);
  });
});
