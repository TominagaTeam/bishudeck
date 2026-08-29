import { describe, expect, it } from 'vitest';

import { formatMeasure } from './measure';

const box = { cx: 200, cy: 150, width: 100, height: 60, rotation: 0 };

describe('formatMeasure', () => {
  it('reports the top-left corner while moving', () => {
    expect(formatMeasure({ kind: 'move', box })).toBe('150, 120');
  });

  it('reports width by height while resizing', () => {
    expect(formatMeasure({ kind: 'resize', box })).toBe('100 × 60');
  });

  it('reports degrees while rotating', () => {
    expect(formatMeasure({ kind: 'rotate', box: { ...box, rotation: 33.456 } })).toBe('33.46°');
  });

  it('keeps the angle inside one turn', () => {
    expect(formatMeasure({ kind: 'rotate', box: { ...box, rotation: -90 } })).toBe('270°');
    expect(formatMeasure({ kind: 'rotate', box: { ...box, rotation: 405 } })).toBe('45°');
  });

  it('rounds position and size to whole pixels', () => {
    const odd = { cx: 200.4, cy: 150.6, width: 99.5, height: 60.4, rotation: 0 };
    expect(formatMeasure({ kind: 'move', box: odd })).toBe('151, 120');
    expect(formatMeasure({ kind: 'resize', box: odd })).toBe('100 × 60');
  });

  it('uses the rotated footprint when reporting position', () => {
    // A square turned 45° reaches further than its own width.
    const turned = { cx: 100, cy: 100, width: 100, height: 100, rotation: 45 };
    expect(formatMeasure({ kind: 'move', box: turned })).toBe('29, 29');
  });
});
