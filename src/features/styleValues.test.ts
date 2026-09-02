import { describe, expect, it } from 'vitest';

import { normalizeWeight, shownAlign } from './styleValues';

// The weight menu offers 300–900, and a `<select>` shows its first option for
// any value it does not recognise. A deck that wrote `bold` would therefore
// display as 300 — and the next thing the panel wrote would set the heading to
// 300, thinning text nobody touched.
describe('normalizeWeight', () => {
  it('maps the keywords onto the numbers the menu offers', () => {
    expect(normalizeWeight('bold')).toBe('700');
    expect(normalizeWeight('normal')).toBe('400');
  });

  it('leaves a number alone', () => {
    expect(normalizeWeight('300')).toBe('300');
    expect(normalizeWeight('900')).toBe('900');
  });

  it('falls back to regular when nothing has been read yet', () => {
    // The empty string is what the panel holds for the one render before the
    // computed read for a newly selected element lands.
    expect(normalizeWeight('')).toBe('400');
    expect(normalizeWeight(undefined)).toBe('400');
  });
});

// A box nobody has aligned computes to `start`, so comparing the computed value
// with the buttons' own values lit none of the four and the row claimed nothing
// had been chosen about text that was plainly against one edge.
describe('shownAlign', () => {
  it('lights 左 on a left-to-right element nobody has aligned', () => {
    expect(shownAlign('start', 'ltr')).toBe('left');
    expect(shownAlign('end', 'ltr')).toBe('right');
  });

  it('lights the side the words are actually on when the deck runs right to left', () => {
    // The buttons are labelled by physical side, so `start` in an RTL box has
    // to light 右 — answering 左 would name the empty edge.
    expect(shownAlign('start', 'rtl')).toBe('right');
    expect(shownAlign('end', 'rtl')).toBe('left');
  });

  it('leaves a physical value alone', () => {
    for (const value of ['left', 'center', 'right']) {
      expect(shownAlign(value, 'ltr')).toBe(value);
      expect(shownAlign(value, 'rtl')).toBe(value);
    }
  });

  /**
   * The 両端 button is gone, and `justify` is left passing through
   * rather than resolved to one of the three — so a deck that justifies its own
   * text lights no button at all. That is the accepted cost of dropping the
   * button, written down here: mapping it to 左 would be worse, because the row
   * would then claim a choice the element does not carry, and the next click on
   * 左 would look like a no-op while writing an override.
   */
  it('lights nothing for a deck’s own justify', () => {
    expect(shownAlign('justify', 'ltr')).toBe('justify');
    expect(['left', 'center', 'right']).not.toContain(shownAlign('justify', 'ltr'));
  });

  it('lights nothing until the computed read lands', () => {
    // The empty string is what the panel holds for the one render before the
    // read for a newly selected element arrives; `''` matches no button.
    expect(shownAlign('', 'ltr')).toBe('');
    expect(shownAlign(undefined, undefined)).toBe('');
  });

  it('treats a missing direction as left-to-right', () => {
    // `direction` joined READ_PROPERTIES with this change, so a stale read from
    // before it may still be in hand for one render.
    expect(shownAlign('start', undefined)).toBe('left');
  });
});
