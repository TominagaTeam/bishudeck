import { describe, expect, it } from 'vitest';

import { cursorForHandle } from './handleCursor';

describe('cursorForHandle', () => {
  it('matches the static CSS when nothing is rotated', () => {
    // These are the values styles.css hard-codes, so an unrotated selection
    // must not change appearance when the cursor starts being computed.
    expect(cursorForHandle('nw', 0)).toBe('nwse-resize');
    expect(cursorForHandle('n', 0)).toBe('ns-resize');
    expect(cursorForHandle('ne', 0)).toBe('nesw-resize');
    expect(cursorForHandle('e', 0)).toBe('ew-resize');
    expect(cursorForHandle('se', 0)).toBe('nwse-resize');
    expect(cursorForHandle('s', 0)).toBe('ns-resize');
    expect(cursorForHandle('sw', 0)).toBe('nesw-resize');
    expect(cursorForHandle('w', 0)).toBe('ew-resize');
  });

  it('turns the corner cursor with the element', () => {
    expect(cursorForHandle('se', 90)).toBe('nesw-resize');
    expect(cursorForHandle('e', 90)).toBe('ns-resize');
    expect(cursorForHandle('n', 45)).toBe('nesw-resize');
  });

  it('comes back to itself after a half turn', () => {
    // Resize cursors are bidirectional, so 180° is the identity.
    for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const) {
      expect(cursorForHandle(handle, 180)).toBe(cursorForHandle(handle, 0));
    }
  });

  it('rounds to the nearest 45° step', () => {
    expect(cursorForHandle('e', 22.4)).toBe('ew-resize');
    expect(cursorForHandle('e', 22.5)).toBe('nwse-resize');
  });

  it('normalises angles outside a single turn', () => {
    expect(cursorForHandle('se', -90)).toBe('nesw-resize');
    expect(cursorForHandle('se', 450)).toBe('nesw-resize');
    expect(cursorForHandle('e', -360)).toBe('ew-resize');
  });
});
