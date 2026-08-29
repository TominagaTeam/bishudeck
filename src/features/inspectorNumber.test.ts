import { describe, expect, it } from 'vitest';

import { paddingStyle, sidesOf } from './Inspector';
import { parseNumberDraft, parsePixels } from './styleValues';

/**
 * `Number('')` is 0, so an emptied X field used to commit a real zero and send
 * the element to the corner of the slide (issues #10). `type="number"` hands
 * back an empty string for letters too, so "abc" did the same.
 */
describe('parseNumberDraft', () => {
  it('refuses a field the user emptied', () => {
    expect(parseNumberDraft('')).toBeNull();
    expect(parseNumberDraft('   ')).toBeNull();
  });

  it('refuses what type="number" reports for letters', () => {
    expect(parseNumberDraft('abc')).toBeNull();
  });

  it('refuses values that are not finite', () => {
    expect(parseNumberDraft('Infinity')).toBeNull();
    expect(parseNumberDraft('NaN')).toBeNull();
  });

  // Zero is a legitimate x, y and rotation, so nothing here may lean on falsiness.
  it('accepts zero', () => {
    expect(parseNumberDraft('0')).toBe(0);
    expect(parseNumberDraft('-0')).toBe(-0);
  });

  it('accepts the numbers the panel actually produces', () => {
    expect(parseNumberDraft('-12.5')).toBe(-12.5);
    expect(parseNumberDraft('360')).toBe(360);
    expect(parseNumberDraft(' 48 ')).toBe(48);
  });
});

/**
 * The padding and radius fields take a number and put the unit in the
 * interface, so what comes out of `getComputedStyle` has to become one — and
 * anything that is not a length has to be refused rather than guessed at
 * (issues #21).
 */
describe('parsePixels', () => {
  it('reads the lengths computed style actually hands back', () => {
    expect(parsePixels('10px')).toBe(10);
    expect(parsePixels('0px')).toBe(0);
    expect(parsePixels('10.5px')).toBe(10.5);
    expect(parsePixels(' 24px ')).toBe(24);
  });

  it('refuses what no number field can show', () => {
    expect(parsePixels(undefined)).toBeNull();
    expect(parsePixels('')).toBeNull();
    expect(parsePixels('auto')).toBeNull();
    expect(parsePixels('inherit')).toBeNull();
    // A percentage reaches the panel only from an engine that does not resolve
    // it; showing 5 for `5%` would claim a size the element does not have.
    expect(parsePixels('5%')).toBeNull();
    expect(parsePixels('1em')).toBeNull();
  });
});

const SIDES = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'];

/**
 * Whether one field can speak for the box. The shorthand cannot answer this:
 * `getComputedStyle` returns `10px 20px 10px 20px` the moment the sides differ,
 * which is why the sides are read individually in the first place.
 */
describe('sidesOf', () => {
  it('folds four agreeing sides into one number', () => {
    const styles = Object.fromEntries(SIDES.map((side) => [side, '12px']));
    expect(sidesOf(styles, SIDES)).toEqual({ values: [12, 12, 12, 12], uniform: 12 });
  });

  it('refuses to fold sides that differ, however slightly', () => {
    const styles = Object.fromEntries(SIDES.map((side) => [side, '10px']));
    styles['padding-right'] = '20px';
    expect(sidesOf(styles, SIDES)).toEqual({ values: [10, 20, 10, 10], uniform: null });
  });

  // Zero padding is the common case, and it is uniform like any other value.
  it('treats four zeroes as uniform', () => {
    const styles = Object.fromEntries(SIDES.map((side) => [side, '0px']));
    expect(sidesOf(styles, SIDES).uniform).toBe(0);
  });

  // The panel renders once before the read for the new element lands.
  it('reads an unreadable side as zero rather than dropping the row', () => {
    expect(sidesOf({}, SIDES)).toEqual({ values: [0, 0, 0, 0], uniform: 0 });
  });
});

/**
 * The rule that keeps an adjustment to one undo step. `tryMerge` folds two
 * style commands only when their property sets match, so the panel may never
 * write just the side that changed — see the note on `paddingStyle`.
 */
describe('paddingStyle', () => {
  it('writes all four sides even when one of them changed', () => {
    expect(Object.keys(paddingStyle([1, 2, 3, 4]))).toEqual([
      'padding-top',
      'padding-right',
      'padding-bottom',
      'padding-left',
    ]);
  });

  it('carries the unit the field stopped asking the user for', () => {
    expect(paddingStyle([0, 8, 16, 8])).toEqual({
      'padding-top': '0px',
      'padding-right': '8px',
      'padding-bottom': '16px',
      'padding-left': '8px',
    });
  });
});
