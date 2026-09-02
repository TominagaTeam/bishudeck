// @vitest-environment jsdom
import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SLIDE_ROOT_ATTRIBUTE } from '../core/document/compose';
import { clearHistory, setActiveStage, undo, useHistory } from '../core/commands/engine';
import { setTextSession } from '../core/editing/richText';
import { t } from '../shared/i18n';
import { StageBridge } from '../stage/bridge';
import { TextFormatControls } from './TextFormatControls';

/**
 * The two controls in this panel that write to the element while a session is
 * open — 太さ and 行揃え — and what they owe the words already typed.
 *
 * Everything else here is range scope and goes through `withUndo`, which
 * flushes the session on both sides. These two do not, and the history store
 * publishes on a push as well as on an undo, so the session's baseline used to
 * move past the typing the moment either of them ran: the keystrokes ended up
 * on neither step, and an undo gave back the alignment but not the word.
 *
 * Mounted for real, because what is under test is the wiring — that the press
 * flushes before the command, not that a flush would work if one happened.
 */

let host: HTMLDivElement;
let root: Root;
let heading: HTMLElement;
let uid: string;

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

  (document as Document & { execCommand?: unknown }).execCommand = vi.fn(() => true);

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

const render = () => act(() => root.render(h(TextFormatControls, { uid, styles: { ...STYLES } })));

/**
 * Standing in for typing. The frame runs no scripts, so keystrokes
 * never reach the host and produce no command of their own — the markup simply
 * differs the next time anyone looks.
 */
const type = (text: string) => {
  heading.innerHTML = text;
};

const alignButton = (label: string): HTMLElement =>
  Array.from(host.querySelectorAll('.segmented button')).find(
    (button) => button.textContent === label,
  ) as HTMLElement;

const weightMenu = (): HTMLSelectElement => {
  const label = Array.from(host.querySelectorAll('label')).find(
    (candidate) => candidate.textContent === t('inspector.weight'),
  );
  return document.getElementById(label?.getAttribute('for') as string) as HTMLSelectElement;
};

const labels = () => useHistory.getState().undoStack.map((command) => command.label);

describe('element scope — what it owes an open session', () => {
  it('keeps the typing on the stack when 行揃え runs', () => {
    openSession();
    render();
    type('来期のハイライト');

    act(() => alignButton(t('inspector.alignCenter')).click());

    // Two steps, in the order they happened: the typing cannot be recorded
    // after the alignment, because undoing it replaces the markup and hands out
    // fresh uids — the style step would no longer find the nodes it captured.
    expect(labels()).toEqual([t('command.editText'), t('command.changeStyle')]);
    undo();
    expect(heading.style.textAlign).toBe('');
    undo();
    expect(heading.innerHTML).toBe('今期のハイライト');
  });

  it('keeps the typing on the stack when 太さ runs', () => {
    openSession();
    render();
    type('来期のハイライト');

    act(() => {
      const menu = weightMenu();
      menu.value = '700';
      menu.dispatchEvent(new window.Event('change', { bubbles: true }));
    });

    expect(labels()).toEqual([t('command.editText'), t('command.changeStyle')]);
    undo();
    expect(heading.style.getPropertyValue('font-weight')).toBe('');
    undo();
    expect(heading.innerHTML).toBe('今期のハイライト');
  });

  /** Nothing typed, nothing to flush. `commitTextSession` returns early when the
   *  markup still matches the baseline, so the panel does not have to ask. */
  it('adds no step of its own when nothing was typed', () => {
    openSession();
    render();

    act(() => alignButton(t('inspector.alignRight')).click());

    expect(labels()).toEqual([t('command.changeStyle')]);
  });

  /** Outside a session there is nothing to flush either, and the flush must not
   *  make the control behave differently for it. */
  it('costs the same outside a session', () => {
    render();

    act(() => alignButton(t('inspector.alignRight')).click());

    expect(labels()).toEqual([t('command.changeStyle')]);
  });
});
