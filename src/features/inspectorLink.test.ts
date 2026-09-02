// @vitest-environment jsdom
import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SLIDE_ROOT_ATTRIBUTE } from '../core/document/compose';
import { clearHistory, setActiveStage } from '../core/commands/engine';
import { setTextSession, snapshotSessionRange } from '../core/editing/richText';
import { StageBridge } from '../stage/bridge';
import { normalizeHref } from './LinkDialog';
import { TextFormatControls } from './TextFormatControls';

/**
 * リンク, from the press to the `href`, plus the state the 行揃え buttons owe
 * anyone not looking at the screen.
 *
 * The button used to call `window.prompt`, the app's last one. What replaced it
 * is a dialog the app draws — so the questions worth pinning are the ones the
 * platform used to answer: where the dialog lives in the tree (which is what
 * decides whether the text session outlives the click that opened it), what
 * reaches `execCommand`, and what nothing reaches on the way out.
 *
 * Mounted for real rather than asserted against props, for the same reason the
 * 太さ tests are: the claims below are about the DOM the browser sees.
 */

let host: HTMLDivElement;
let root: Root;
let heading: HTMLElement;
let uid: string;
/** The range each `execCommand` call saw, which is what the link lands on. */
let executed: { command: string; value: string; text: string }[];

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
  (document as Document & { execCommand?: unknown }).execCommand = vi.fn(
    (command: string, _ui: boolean, value?: string) => {
      const selection = window.getSelection();
      const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      executed.push({ command, value: value ?? '', text: range ? range.toString() : '' });
      return true;
    },
  );

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

const render = (styles: Record<string, string> = STYLES) =>
  act(() => root.render(h(TextFormatControls, { uid, styles: { ...styles } })));

const byText = (selector: string, text: string): HTMLElement =>
  Array.from(host.querySelectorAll(selector)).find(
    (candidate) => candidate.textContent === text,
  ) as HTMLElement;

const dialog = () => host.querySelector('.modal-backdrop');
const urlBox = () => host.querySelector('.modal input') as HTMLInputElement;
const applyButton = () => host.querySelector('.modal-actions .primary') as HTMLButtonElement;
const cancelButton = () => host.querySelector('.modal-actions button') as HTMLButtonElement;

const click = (element: Element) => act(() => (element as HTMLElement).click());

const openDialog = () => click(byText('button', 'リンク'));

/** One keystroke, through the prototype's setter so React sees a change. */
const type = (text: string) =>
  act(() => {
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    setValue.call(urlBox(), text);
    urlBox().dispatchEvent(new window.Event('input', { bubbles: true }));
  });

function selectChars(from: number, to: number): void {
  const range = document.createRange();
  range.setStart(heading.firstChild as Node, from);
  range.setEnd(heading.firstChild as Node, to);
  const selection = window.getSelection() as Selection;
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Select, remember the range, then lose it the way host chrome does. */
function selectThenLeaveTheFrame(from: number, to: number): void {
  selectChars(from, to);
  // EditStage's capture listener, on the pointerdown over this panel.
  snapshotSessionRange();
  // The dialog's field takes focus on open; WebKit drops the frame's selection
  // when it goes.
  window.getSelection()?.removeAllRanges();
}

describe('normalizeHref', () => {
  // The input this dialog exists to accept: a deck is exported as a file, and a
  // bare host would resolve against that file's own directory on a machine
  // nobody here can see.
  it('completes a bare host with https', () => {
    expect(normalizeHref('example.com')).toBe('https://example.com');
    expect(normalizeHref('  example.com/a/b?c=d  ')).toBe('https://example.com/a/b?c=d');
  });

  it('leaves anything that already says where it points', () => {
    expect(normalizeHref('https://example.com')).toBe('https://example.com');
    expect(normalizeHref('HTTP://EXAMPLE.COM')).toBe('HTTP://EXAMPLE.COM');
    expect(normalizeHref('mailto:a@example.com')).toBe('mailto:a@example.com');
    expect(normalizeHref('#summary')).toBe('#summary');
    expect(normalizeHref('//example.com/a')).toBe('//example.com/a');
  });

  // The exported deck is opened in a browser and the preview frame does run
  // scripts, so this is a link someone else's machine would execute.
  it('refuses a script URL rather than completing it', () => {
    expect(normalizeHref('javascript:alert(1)')).toBeNull();
    expect(normalizeHref('  JavaScript:alert(1)')).toBeNull();
  });

  it('has nothing to write for an empty box', () => {
    expect(normalizeHref('')).toBeNull();
    expect(normalizeHref('   ')).toBeNull();
  });
});

describe('リンク — asking for the address', () => {
  it('is out of reach until there are words to attach to', () => {
    render();
    expect((byText('button', 'リンク') as HTMLButtonElement).disabled).toBe(true);

    openSession();
    expect((byText('button', 'リンク') as HTMLButtonElement).disabled).toBe(false);
  });

  // The load-bearing one. `data-hse-text-tools` sits on the container above this
  // component (TextPanel, Inspector.tsx) and EditStage ends the session on any
  // pointerdown that does not land under it — so a dialog portalled to `<body>`
  // would close the session on the click that opened it, and 挿入 would have
  // nothing to link. Asserting the ancestry is asserting that it never becomes
  // a portal, which is the change this would break under.
  it('draws itself inside the panel rather than portalling to the body', () => {
    openSession();
    render();
    openDialog();

    const overlay = dialog();
    expect(overlay).not.toBeNull();
    expect(host.contains(overlay as Node)).toBe(true);
    // And there is no second one loose in the document.
    expect(document.querySelectorAll('.modal-backdrop')).toHaveLength(1);
  });

  it('offers nothing to press until the box says where to point', () => {
    openSession();
    render();
    openDialog();

    expect(applyButton().disabled).toBe(true);
    type('   ');
    expect(applyButton().disabled).toBe(true);
    type('javascript:alert(1)');
    expect(applyButton().disabled).toBe(true);
    type('example.com');
    expect(applyButton().disabled).toBe(false);
  });
});

describe('リンク — what confirming does', () => {
  it('writes the completed address onto the words that were selected', () => {
    openSession();
    render();
    openDialog();
    selectThenLeaveTheFrame(0, 2);
    type('example.com');
    click(applyButton());

    expect(executed).toEqual([
      { command: 'createLink', value: 'https://example.com', text: '今期' },
    ]);
    expect(dialog()).toBeNull();
  });

  // Enter in the field is the whole reason this is a `<form>`: the address is
  // typed and confirmed without the hand leaving the keyboard.
  it('confirms on Enter in the field', () => {
    openSession();
    render();
    openDialog();
    selectThenLeaveTheFrame(0, 2);
    type('https://example.com/a');
    act(() => {
      (host.querySelector('form') as HTMLFormElement).dispatchEvent(
        new window.Event('submit', { bubbles: true, cancelable: true }),
      );
    });

    expect(executed).toEqual([
      { command: 'createLink', value: 'https://example.com/a', text: '今期' },
    ]);
  });
});

describe('リンク — the ways out that write nothing', () => {
  it('writes nothing when the dialog is cancelled', () => {
    openSession();
    render();
    openDialog();
    selectThenLeaveTheFrame(0, 2);
    type('example.com');
    click(cancelButton());

    expect(dialog()).toBeNull();
    expect(executed).toEqual([]);
    expect(heading.innerHTML).toBe('今期のハイライト');
  });

  // The dialog collects a URL for a range, so a session that has ended takes it
  // with it. It ends for reasons this component cannot see — Escape reaches
  // EditStage's capture listener before ModalShell's, and a click on the canvas
  // ends it outright — so the dialog watches the session rather than trusting
  // every one of those paths to close it on the way past. Left open, it would
  // hang over an element nobody is editing with an 挿入 button that does nothing.
  it('goes away with the session it was collecting a URL for', () => {
    openSession();
    render();
    openDialog();
    expect(dialog()).not.toBeNull();

    act(() => setTextSession(null));
    expect(dialog()).toBeNull();
  });

  // And does not come back with the next one: it is local state, so a press
  // that was abandoned is not a dialog waiting on the next double-click.
  it('stays shut when a session opens again', () => {
    openSession();
    render();
    openDialog();
    act(() => setTextSession(null));
    openSession();

    expect(dialog()).toBeNull();
  });
});

/** The 行揃え group, found the way its label names it (`Field`). */
const alignGroup = (): HTMLElement => {
  const label = Array.from(host.querySelectorAll('span')).find(
    (candidate) => candidate.textContent === '行揃え',
  );
  return host.querySelector(`[aria-labelledby="${label?.id}"]`) as HTMLElement;
};

const pressedAligns = () =>
  Array.from(alignGroup().querySelectorAll('button')).map((button) => [
    button.textContent,
    button.getAttribute('aria-pressed'),
  ]);

describe('行揃え — which one is lit', () => {
  // B, I, U, S, x², 箇条書き and 番号 all carry `aria-pressed`; these three
  // carried only a class, so they were the one group in this panel whose state
  // was visible to the eye and to nothing else.
  it('says which way the lines run, not only in the class', () => {
    render();
    expect(pressedAligns()).toEqual([
      ['左', 'true'],
      ['中央', 'false'],
      ['右', 'false'],
    ]);

    render({ ...STYLES, 'text-align': 'center' });
    expect(pressedAligns()).toEqual([
      ['左', 'false'],
      ['中央', 'true'],
      ['右', 'false'],
    ]);
  });

  // Through `shownAlign`, which is what keeps an untouched element — computing
  // to `start` above, and to `end` here — from lighting none of the three while
  // sitting plainly against one edge.
  it('reads a logical value against the writing direction', () => {
    render({ ...STYLES, 'text-align': 'end', direction: 'rtl' });
    expect(pressedAligns()).toEqual([
      ['左', 'true'],
      ['中央', 'false'],
      ['右', 'false'],
    ]);
  });

  it('keeps the class the segmented control is drawn from', () => {
    render({ ...STYLES, 'text-align': 'right' });
    const lit = Array.from(alignGroup().querySelectorAll('button')).filter((button) =>
      button.classList.contains('active'),
    );
    expect(lit.map((button) => button.textContent)).toEqual(['右']);
  });
});
