import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Field } from './Field';

/**
 * What `Field` has to get right is where a click lands.
 *
 * A `<label>` with no `for` adopts the first labelable element under it, and
 * `button` is labelable — so a row of buttons wrapped in one forwarded clicks
 * from the label text, the rest of the 56px column and the slack beside the
 * controls straight into its first button. These mount the real
 * component and press the label cell, because the association is a property of
 * the markup rather than of anything the component computes.
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

/** The label cell: the words and, with them, the rest of the 56px column. */
const labelCell = () => host.querySelector<HTMLElement>('.field > span, .field > label')!;

const click = (el: Element) =>
  act(() => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });

describe('Field — a row of several controls', () => {
  it('does not press the first button when the label is clicked', () => {
    const pressed: string[] = [];
    render(
      h(Field, {
        label: '行揃え',
        children: h('div', { className: 'segmented' }, [
          h('button', { key: 'l', onClick: () => pressed.push('左') }, '左'),
          h('button', { key: 'c', onClick: () => pressed.push('中央') }, '中央'),
        ]),
      }),
    );

    click(labelCell());
    expect(pressed).toEqual([]);
  });

  // Two split colour buttons on 文字色: the first one fired when the words
  // beside it were clicked, applying a colour nobody asked for.
  it('does not press the first colour button when the label is clicked', () => {
    const opened: string[] = [];
    render(
      h(Field, {
        label: '文字色',
        children: [
          h('button', { key: 'fg', onClick: () => opened.push('文字色') }),
          h('button', { key: 'hl', onClick: () => opened.push('蛍光') }),
        ],
      }),
    );

    click(labelCell());
    expect(opened).toEqual([]);
  });

  // The label text is not thrown away with the association: a group that only
  // has words beside it is a group with no name at all.
  it('names the group with the label instead', () => {
    render(h(Field, { label: '行揃え', children: h('button', null, '左') }));

    const group = host.querySelector('.field-control')!;
    expect(group.getAttribute('role')).toBe('group');
    expect(document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent).toBe(
      '行揃え',
    );
  });

  it('is not a label element at all', () => {
    render(h(Field, { label: '行揃え', children: h('button', null, '左') }));
    expect(host.querySelector('.field')!.tagName).toBe('DIV');
    expect(host.querySelector('label')).toBeNull();
  });
});

/**
 * Measured as forwarding rather than as focus: jsdom moves focus for neither a
 * click on a control nor a click away from one, so `activeElement` would answer
 * the same whatever the markup said. Forwarding is the mechanism underneath —
 * it is what puts the focus back in a real browser — and jsdom implements it.
 */
describe('Field — a row with one control', () => {
  const oneBox = (onBoxClick: () => void) =>
    h(Field, {
      label: 'サイズ',
      children: (id: string) => [
        h('input', { key: 'box', id, type: 'number', defaultValue: 24, onClick: onBoxClick }),
        h('span', { key: 'unit', className: 'unit' }, 'px'),
      ],
    });

  it('ties the label to that control, so pressing the words reaches it', () => {
    let reached = 0;
    render(oneBox(() => (reached += 1)));

    const box = host.querySelector('input')!;
    expect(labelCell().tagName).toBe('LABEL');
    expect(labelCell().getAttribute('for')).toBe(box.id);

    click(labelCell());
    expect(reached).toBe(1);
  });

  // The reported symptom: the slack to the right of a fixed-width box used to
  // be inside the label, so a click there went to the box — which blurred it
  // and immediately handed the focus back.
  it('leaves the control alone when the slack beside it is clicked', () => {
    let reached = 0;
    render(oneBox(() => (reached += 1)));

    // Guards the assertion below from passing because the row rendered nothing.
    expect(host.querySelector('input')).not.toBeNull();
    click(host.querySelector('.field-control')!);
    expect(reached).toBe(0);
  });
});
