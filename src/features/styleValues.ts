/**
 * Reading a computed CSS value the way a form control needs it.
 *
 * These live apart from the panels that use them for two reasons. `Inspector`
 * imports `TextFormatControls`, so anything both of them need cannot sit in
 * either without a cycle — the same problem `Field` was pulled out to solve.
 * And a `.tsx` file is invisible to the test
 * runner (`vite.config.ts` includes `src/**\/*.test.ts` only), so a judgement
 * worth testing has to live in a `.ts` one.
 */

/**
 * No fill: unset, the keyword, or any colour the browser resolved to zero alpha
 * (a box with no background computes to `rgba(0, 0, 0, 0)`).
 */
export function isTransparent(value: string | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === 'transparent') return true;
  return alphaOf(trimmed) === 0;
}

/** The alpha of an `rgb()` / `rgba()` value, in either the comma or the slash
 *  form, or null when the value carries no alpha at all. */
function alphaOf(value: string): number | null {
  const match = value.match(/rgba?\(([^)]+)\)/i);
  if (!match) return null;
  // Both `r, g, b, a` and the space/slash form `r g b / a` land as four parts.
  const parts = match[1].split(/[,\s/]+/).filter(Boolean);
  if (parts.length < 4) return null;
  const alpha = parseFloat(parts[3]);
  if (Number.isNaN(alpha)) return null;
  return parts[3].endsWith('%') ? alpha / 100 : alpha;
}

/** `<input type="color">` only accepts `#rrggbb`, so anything else becomes black. */
export function toHex(value: string | undefined): string {
  if (!value) return '#000000';
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
  const [, r, g, b] = match;
  return `#${[r, g, b].map((c) => Number(c).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Whether two colours are the same one spelled differently.
 *
 * A swatch holds `#ffe066`, the draft holds `#FFE066`, and the frame answers
 * `rgb(255, 224, 102)` — three spellings of one colour, and exactly one square
 * in the palette has to light. Both sides go through `toHex`, so both inherit
 * its habit of answering `#000000` for anything unreadable: two values it
 * cannot parse compare equal, as black. That is the honest trade for a caller
 * whose inputs are a fixed table and a draft that is always `#rrggbb`.
 */
export function sameColor(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return toHex(a).toLowerCase() === toHex(b).toLowerCase();
}

/**
 * A weight the numeric menu can select.
 *
 * `getComputedStyle` answers with the keyword a deck wrote (`bold`) as readily
 * as with a number, and a `<select>` whose options are 300–900 shows the first
 * option for anything it does not recognise — so an unmapped `bold` would
 * display as 300 and set the heading to 300 the moment anything else on the
 * panel wrote a style.
 */
export function normalizeWeight(value: string | undefined): string {
  if (!value) return '400';
  if (value === 'normal') return '400';
  if (value === 'bold') return '700';
  return value;
}

/**
 * A computed length as a number, or null when it is not a length at all.
 *
 * Only `px` counts. Both target WebViews resolve padding and radius to pixels,
 * so anything else here (`auto`, a keyword, the empty string a panel holds for
 * one render) is a value this field cannot represent — and guessing a number
 * out of it would show the user a size their element does not have.
 */
export function parsePixels(value: string | undefined): number | null {
  if (!value?.trim().endsWith('px')) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * What a number field's text means, or null when it means nothing.
 *
 * `Number('')` is 0, not NaN, so a NaN guard lets an emptied field commit a
 * real zero and fling the element to the slide's top-left — and `type="number"`
 * reports letters as an empty string, so typing "abc" did the same thing.
 * Emptiness is therefore checked before the conversion, and `Number.isFinite`
 * closes Infinity as well as NaN.
 *
 * "0" has to survive: it is a legitimate x, y and rotation, so nothing here may
 * lean on falsiness.
 */
export function parseNumberDraft(draft: string): number | null {
  if (draft.trim() === '') return null;
  const value = Number(draft);
  return Number.isFinite(value) ? value : null;
}

/** The physical side each logical keyword stands for, per writing direction. */
const LOGICAL_SIDES: Record<string, { ltr: string; rtl: string }> = {
  start: { ltr: 'left', rtl: 'right' },
  end: { ltr: 'right', rtl: 'left' },
};

/**
 * Which of the three alignment buttons a computed `text-align` lights.
 *
 * An element nobody has aligned computes to `start`, never to `left`, so
 * comparing the computed value against the buttons' own values lights none of
 * them: the row says "nothing chosen yet" about text that is plainly aligned to
 * one side. `start` and `end` are the logical pair of
 * `left` and `right`, and which physical side either one means is the element's
 * `direction` to decide — the buttons are labelled 左 / 右, so the one that
 * lights has to be the side the words actually sit on, not the side an LTR deck
 * would usually imply.
 *
 * This reads; it does not write. It is deliberately the mirror of
 * `chosenAlign()` (core/editing/listOverrides.ts), which keeps `start` meaning
 * "nobody chose" so that bulleting a line writes no override nobody asked for.
 * Resolving the keyword here instead of there shows the truth without turning
 * the absence of a choice into a declaration.
 *
 * Everything else passes through, the empty string included: that is what the
 * panel holds for the one render before the computed read lands, and lighting
 * nothing is the right answer while nothing is known.
 *
 * `justify` passes through to nothing now that the 両端 button is gone, so a
 * deck that justifies its own text lights no button. That is the
 * cost of dropping the button and is deliberate: resolving it to 左 would claim
 * a choice the element does not carry.
 */
export function shownAlign(align: string | undefined, direction: string | undefined): string {
  const value = align?.trim() ?? '';
  const sides = LOGICAL_SIDES[value];
  if (!sides) return value;
  return direction?.trim() === 'rtl' ? sides.rtl : sides.ltr;
}
