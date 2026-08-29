import { describe, expect, it } from 'vitest';

import { toCssPixels } from './backend';
import { isImagePath } from './imagePicker';

/**
 * The one number a dropped file arrives with, and the one thing the two
 * platforms disagree about.
 *
 * Tauri types the drop position as `PhysicalPosition` on both, but macOS fills
 * it from AppKit points — CSS pixels already — while Windows fills it from
 * `ScreenToClient`, which is device pixels. Converting on both would halve
 * every coordinate on a Retina display; converting on neither would double
 * them on a scaled Windows desktop. Either way the picture lands in the wrong
 * box, or in none.
 */
describe('toCssPixels', () => {
  it('leaves macOS alone, Retina included', () => {
    expect(toCssPixels({ x: 400, y: 300 }, 'mac', 2)).toEqual({ x: 400, y: 300 });
    expect(toCssPixels({ x: 400, y: 300 }, 'mac', 1)).toEqual({ x: 400, y: 300 });
  });

  it('divides on Windows and Linux', () => {
    expect(toCssPixels({ x: 400, y: 300 }, 'windows', 2)).toEqual({ x: 200, y: 150 });
    expect(toCssPixels({ x: 375, y: 250 }, 'windows', 1.25)).toEqual({ x: 300, y: 200 });
    expect(toCssPixels({ x: 400, y: 300 }, 'linux', 1)).toEqual({ x: 400, y: 300 });
  });

  /** A ratio of 0 would send every coordinate to Infinity, and the browser is
   *  free to report one before layout has settled. */
  it('treats a missing ratio as 1', () => {
    expect(toCssPixels({ x: 400, y: 300 }, 'windows', 0)).toEqual({ x: 400, y: 300 });
  });
});

/**
 * What was dragged is not necessarily one image: a drag carries everything
 * that was selected, and directories arrive as paths too.
 */
describe('isImagePath', () => {
  it('takes the formats the file dialog offers', () => {
    expect(isImagePath('/Users/x/shot.png')).toBe(true);
    expect(isImagePath('/Users/x/shot.JPG')).toBe(true);
    expect(isImagePath('C:\\Users\\x\\photo.webp')).toBe(true);
  });

  it('refuses everything else, directories included', () => {
    expect(isImagePath('/Users/x/notes.pdf')).toBe(false);
    expect(isImagePath('/Users/x/Pictures')).toBe(false);
    // A dotfile's name reads as one long extension, which matches nothing.
    expect(isImagePath('/Users/x/.hidden')).toBe(false);
    expect(isImagePath('')).toBe(false);
  });
});
