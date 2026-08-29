import { describe, expect, it } from 'vitest';

import { isTransparent, sameColor, toHex } from './styleValues';

// A colour input cannot say "no fill", so the panel decides between 透明 and
// 単色 from the computed value. Getting this wrong showed every unfilled box
// as filled with black.
describe('isTransparent', () => {
  it('treats a missing or unset value as no fill', () => {
    expect(isTransparent(undefined)).toBe(true);
    expect(isTransparent('')).toBe(true);
    expect(isTransparent('  ')).toBe(true);
  });

  it('treats the keyword and zero alpha as no fill', () => {
    expect(isTransparent('transparent')).toBe(true);
    // What a box with no background computes to.
    expect(isTransparent('rgba(0, 0, 0, 0)')).toBe(true);
    expect(isTransparent('rgba(255, 0, 0, 0)')).toBe(true);
    expect(isTransparent('rgb(0 0 0 / 0)')).toBe(true);
    expect(isTransparent('rgb(0 0 0 / 0%)')).toBe(true);
  });

  it('treats any visible colour as a fill', () => {
    expect(isTransparent('rgb(0, 0, 0)')).toBe(false);
    expect(isTransparent('rgba(0, 0, 0, 0.01)')).toBe(false);
    expect(isTransparent('rgb(0 0 0 / 50%)')).toBe(false);
    expect(isTransparent('#000000')).toBe(false);
  });
});

describe('toHex', () => {
  it('converts computed colours to what a colour input accepts', () => {
    expect(toHex('rgb(255, 0, 128)')).toBe('#ff0080');
    expect(toHex('rgba(18, 52, 86, 0.5)')).toBe('#123456');
    expect(toHex('#abcdef')).toBe('#abcdef');
  });
});

// Which square in the palette is the one already in use. The three spellings
// below all reach the picker: the table's own, a draft that has been through a
// colour input, and the frame's computed answer.
describe('sameColor', () => {
  it('sees past the spelling', () => {
    expect(sameColor('#ffe066', '#FFE066')).toBe(true);
    expect(sameColor('rgb(255, 224, 102)', '#ffe066')).toBe(true);
    expect(sameColor('rgba(255, 224, 102, 0.5)', '#ffe066')).toBe(true);
  });

  it('keeps different colours apart', () => {
    expect(sameColor('#ffe066', '#ffe067')).toBe(false);
    expect(sameColor('rgb(255, 224, 102)', '#000000')).toBe(false);
  });

  it('lights nothing while a value is missing', () => {
    // The panel holds an empty string for the render before the computed read
    // lands, and no square should light for "not known yet".
    expect(sameColor(undefined, '#ffffff')).toBe(false);
    expect(sameColor('', '#ffffff')).toBe(false);
    expect(sameColor('#ffffff', '')).toBe(false);
  });
});
