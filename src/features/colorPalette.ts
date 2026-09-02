/**
 * The colours the picker offers, and the arithmetic for walking them.
 *
 * A `.ts` rather than part of the component for the usual reason: the test
 * runner only sees `.ts` files (`vite.config.ts` includes `src/**\/*.test.ts`),
 * so a judgement worth testing has to live in one.
 */

/**
 * How many swatches sit in a row.
 *
 * The grid is written from this number rather than from `auto-fit`, because the
 * arrow keys need the same count to step a row at a time. Letting CSS decide
 * and reading it back with `getComputedStyle` would put one fact in two places.
 */
export const SWATCH_COLUMNS = 8;

/** Which way each arrow moves through a grid laid out row by row. */
const ARROW_STEPS: Record<string, number> = {
  ArrowRight: 1,
  ArrowLeft: -1,
  ArrowDown: SWATCH_COLUMNS,
  ArrowUp: -SWATCH_COLUMNS,
};

/**
 * One table, used by both the text colour and the highlighter.
 *
 * Two tables would be two things to grow, and whichever one a colour was added
 * to would quietly be the only one that had it. The pale row is the
 * highlighter's natural range and keeps `#ffe066`, the yellow the highlighter
 * defaulted to before it had anywhere to remember a colour.
 */
export const PRESET_COLORS = [
  // Greyscale, white through black.
  '#ffffff',
  '#e9ecef',
  '#ced4da',
  '#868e96',
  '#495057',
  '#343a40',
  '#212529',
  '#000000',
  // Saturated.
  '#e03131',
  '#f76707',
  '#f59f00',
  '#2f9e44',
  '#0ca678',
  '#1971c2',
  '#6741d9',
  '#c2255c',
  // Pale — highlighter territory.
  '#ffc9c9',
  '#ffd8a8',
  '#ffe066',
  '#b2f2bb',
  '#96f2d7',
  '#a5d8ff',
  '#d0bfff',
  '#fcc2d7',
];

/**
 * Where an arrow key lands in the grid, or null when it lands nowhere.
 *
 * Clamped rather than wrapped: a grid the eye reads as three rows should not
 * teleport from its first cell to its last. Null covers the edges and the keys
 * that are not ours alike, which leaves the caller one thing to check before it
 * takes the event away from the browser — Tab has to keep working.
 */
export function nextSwatchIndex(current: number, key: string, total: number): number | null {
  const step = ARROW_STEPS[key];
  if (step === undefined) return null;
  const next = current + step;
  return next >= 0 && next < total ? next : null;
}
