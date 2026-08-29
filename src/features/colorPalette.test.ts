import { describe, expect, it } from 'vitest';

import { PRESET_COLORS, SWATCH_COLUMNS, nextSwatchIndex } from './colorPalette';

// The table is read straight into a grid and into `<button style>`, so a typo
// in it shows up as a swatch that is silently black rather than as an error.
describe('PRESET_COLORS', () => {
  it('is written in the one form a colour input and a swatch both accept', () => {
    for (const color of PRESET_COLORS) expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('offers each colour once', () => {
    // A duplicate would light two squares for one value, and the second one
    // would look like a square that cannot be selected.
    expect(new Set(PRESET_COLORS).size).toBe(PRESET_COLORS.length);
  });

  it('fills whole rows', () => {
    expect(PRESET_COLORS.length % SWATCH_COLUMNS).toBe(0);
  });

  it('still offers the yellow the highlighter used to default to', () => {
    expect(PRESET_COLORS).toContain('#ffe066');
  });
});

describe('nextSwatchIndex', () => {
  const total = PRESET_COLORS.length;

  it('walks along a row', () => {
    expect(nextSwatchIndex(0, 'ArrowRight', total)).toBe(1);
    expect(nextSwatchIndex(1, 'ArrowLeft', total)).toBe(0);
  });

  it('carries on into the next row at the end of one', () => {
    // The grid reads left to right, so the square after the last of a row is
    // the first of the next — not a dead end.
    expect(nextSwatchIndex(SWATCH_COLUMNS - 1, 'ArrowRight', total)).toBe(SWATCH_COLUMNS);
  });

  it('steps a whole row at a time vertically', () => {
    expect(nextSwatchIndex(1, 'ArrowDown', total)).toBe(1 + SWATCH_COLUMNS);
    expect(nextSwatchIndex(1 + SWATCH_COLUMNS, 'ArrowUp', total)).toBe(1);
  });

  it('stops at the edges instead of wrapping', () => {
    // Wrapping from the first square to the last would move the eye somewhere
    // the key did not point.
    expect(nextSwatchIndex(0, 'ArrowLeft', total)).toBeNull();
    expect(nextSwatchIndex(0, 'ArrowUp', total)).toBeNull();
    expect(nextSwatchIndex(total - 1, 'ArrowRight', total)).toBeNull();
    expect(nextSwatchIndex(total - 1, 'ArrowDown', total)).toBeNull();
  });

  it('leaves every other key alone', () => {
    // The caller only takes the event away from the browser when this answers,
    // so anything else here would swallow Tab or Escape.
    expect(nextSwatchIndex(0, 'Tab', total)).toBeNull();
    expect(nextSwatchIndex(0, 'Escape', total)).toBeNull();
    expect(nextSwatchIndex(0, 'Enter', total)).toBeNull();
    expect(nextSwatchIndex(0, ' ', total)).toBeNull();
  });
});
