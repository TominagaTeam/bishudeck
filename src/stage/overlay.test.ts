import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Overlay } from './Overlay';
import type { OrientedBox } from './geometry';

/**
 * Where the selection frame is painted while a text session is open.
 *
 * The frame is on the element's boundary everywhere else, and with
 * `box-sizing: border-box` its line lands just inside that boundary — which is
 * where the caret stands. On a blank box both are the editor's blue
 * (placeholder.ts colours the caret while the element is empty), so the caret
 * was painted over and could not be found (issues #99). The frame steps outside
 * during a session, drawn as an offset outline so the fill still stops at the
 * element's edge.
 *
 * jsdom applies no stylesheet, so what is checked here is the half the
 * component decides: the offset, and that the box itself did not move with it.
 */

const BOX: OrientedBox = { cx: 200, cy: 120, width: 160, height: 40, rotation: 0 };

/** Half scale, so a hairline is 2 stage pixels and the offset is easy to read. */
const SCALE = 0.5;

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

const noop = () => {};

function render(editing: boolean) {
  act(() =>
    root.render(
      h(Overlay, {
        selection: BOX,
        hover: null,
        focus: null,
        guides: [],
        measure: null,
        scale: SCALE,
        stageWidth: 960,
        stageHeight: 540,
        editing,
        onHandleDown: noop,
        onFrameDown: noop,
        onRotateDown: noop,
        onShieldDown: noop,
        onTextDown: noop,
        onTextMove: noop,
        onTextUp: noop,
        onContextMenu: noop,
      }),
    ),
  );
  return host.querySelector<HTMLElement>('.overlay-selection')!;
}

describe('Overlay', () => {
  it('holds the frame away from the element while its text is edited', () => {
    const frame = render(true);
    // Three screen pixels out, which at half scale is six stage pixels.
    expect(parseFloat(frame.style.outlineOffset)).toBeCloseTo(6);
    expect(parseFloat(frame.style.outlineWidth)).toBeCloseTo(4);
  });

  it('leaves the fill where it was: only the line moves out', () => {
    const frame = render(true);
    expect(frame.style.left).toBe('120px');
    expect(frame.style.top).toBe('100px');
    expect(frame.style.width).toBe('160px');
    expect(frame.style.height).toBe('40px');
  });

  it('draws on the boundary itself when the element is merely selected', () => {
    const frame = render(false);
    expect(frame.style.outlineOffset).toBe('');
    expect(frame.style.outlineWidth).toBe('');
  });
});

describe('move grips', () => {
  it('draws four edges to take hold of while the selection is idle', () => {
    // The one route to an element a hit test cannot name (issues #102): the
    // frame is host chrome, so it is reachable however the element under it is
    // clipped, covered or refusing the pointer.
    render(false);
    expect(Array.from(host.querySelectorAll('.overlay-grip')).map((el) => el.className)).toEqual([
      'overlay-grip grip-n',
      'overlay-grip grip-e',
      'overlay-grip grip-s',
      'overlay-grip grip-w',
    ]);
  });

  it('draws none while text is being edited', () => {
    // A press on the frame then means "put the caret there", and the shields
    // already own every press around the element.
    render(true);
    expect(host.querySelectorAll('.overlay-grip')).toHaveLength(0);
  });

  it('keeps the corners resizing, not moving', () => {
    // Both cover the corner; the later sibling is the one a press reaches.
    const frame = render(false);
    const nodes = Array.from(frame.children).map((el) => el.className.split(' ')[0]);
    expect(nodes.indexOf('overlay-grip')).toBeLessThan(nodes.indexOf('overlay-handle'));
  });
});

