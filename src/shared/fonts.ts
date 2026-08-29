/**
 * The fonts the editor offers, and which of them this machine can actually
 * render.
 *
 * The catalog lists macOS and Windows families side by side on purpose: the
 * same deck gets edited on both, so the picker has to know about faces this
 * machine does not have. Offering one anyway would be worse than useless — the
 * browser would silently substitute something else and the slide would look
 * different on the next machine without ever saying so. Availability is
 * therefore probed at runtime and missing families are hidden, not greyed out.
 *
 * Probing is done by measuring, not by asking: `document.fonts.check()` answers
 * about registered `@font-face` rules, which says nothing about the locally
 * installed families this list is made of.
 *
 * The exception is the faces the app ships with ({@link BUNDLED_FONT_FAMILIES}),
 * which are offered unprobed. Not as a favour — measuring them would be *wrong*
 * here. They arrive as `@font-face` rules in the documents that draw slides, and
 * this measures the app window, so a face that renders perfectly on the stage
 * can read as missing. What the probe is for is the question "does this machine
 * have it?", and for these the answer is settled before the app starts.
 *
 * Typeface names stay here rather than in the message catalog — a proper noun
 * is the same in every language, and translating it would leave the reader
 * unable to tell which face they were choosing. The one string that *is* looked
 * up is the default entry's, because what it says is 「既定」 and not the name
 * of anything ({@link defaultChoice}).
 */

import { BUNDLED_FONT_FAMILIES } from './bundledFonts';
import { t } from './i18n';

/**
 * What the editor writes when nothing else is chosen.
 *
 * Noto Sans leads because it is the one family that covers Latin and Japanese
 * in the same design — and, since the app started shipping it, the one the
 * editor can promise is there. The system faces behind it are not dead weight:
 * an *exported* deck is read somewhere the app is not, and the chain is what
 * it falls through to there.
 */
export const DEFAULT_FONT_STACK =
  "'Noto Sans', 'Noto Sans JP', 'Noto Sans CJK JP', 'Hiragino Sans', 'Yu Gothic UI', sans-serif";

/**
 * Which section of the picker a face belongs to.
 *
 * Identifiers rather than the text shown: the label is looked up per language
 * (`font.group.*`), and a group whose name *is* its label cannot be translated
 * without changing what the catalog is keyed by.
 */
export type FontGroup = 'default' | 'japanese' | 'latin';

export interface FontChoice {
  /** Shown in the picker. */
  label: string;
  /** Value written into `font-family`. */
  stack: string;
  group: FontGroup;
}

/**
 * A catalog entry: a face, plus the one family whose presence decides whether
 * it is offered at all.
 *
 * The probe is not part of {@link FontChoice} because nothing downstream of
 * {@link availableFonts} has any use for it — by then the question it answers
 * has been answered. It used to be there, as `string | null`, so that the
 * default entry could sit in this same list and opt out of probing; that entry
 * is now built separately ({@link defaultChoice}) and the nullable field went
 * with it, which is what makes the loop below a plain "is it installed?".
 */
export interface CatalogFont extends FontChoice {
  probe: string;
  /**
   * Ships with the app, so {@link probe} is only its name and never a question
   * (shared/bundledFonts.ts). Absent on everything the machine supplies.
   */
  bundled?: true;
}

/** Mixed script and mixed width: a run whose length changes with the face. */
const PROBE_TEXT = 'WMHIiljmw10あア亜漢';

/** Large enough that a one-percent metric difference clears the epsilon. */
const PROBE_SIZE_PX = 72;

/** Sub-pixel jitter is not a difference; a real face moves the run much more. */
const WIDTH_EPSILON = 0.5;

/**
 * Probing against all three generics matters for Japanese faces: on macOS
 * `sans-serif` already *is* a Japanese gothic, so a CJK run alone would look
 * identical and the face would read as missing.
 */
const GENERIC_BASELINES = ['monospace', 'serif', 'sans-serif'] as const;

/** Measures the probe text under a CSS `font` shorthand, in pixels. */
export type MeasureText = (font: string) => number;

function face(
  label: string,
  family: string,
  group: FontGroup,
  generic: 'sans-serif' | 'serif' | 'monospace' = 'sans-serif',
): CatalogFont {
  return { label, stack: `'${family}', ${generic}`, probe: family, group };
}

/** A face the app ships, so nothing about it is conditional. */
function bundledFace(
  family: string,
  group: FontGroup,
  generic: 'sans-serif' | 'serif' | 'monospace' = 'sans-serif',
): CatalogFont {
  return { ...face(family, family, group, generic), bundled: true };
}

export const FONT_CATALOG: CatalogFont[] = [
  /* ---- Japanese: bundled first, then macOS, then Windows ---- */
  bundledFace('Noto Sans JP', 'japanese'),
  face('Noto Serif JP', 'Noto Serif JP', 'japanese', 'serif'),
  face('ヒラギノ角ゴシック', 'Hiragino Sans', 'japanese'),
  face('ヒラギノ角ゴ ProN', 'Hiragino Kaku Gothic ProN', 'japanese'),
  face('ヒラギノ丸ゴ ProN', 'Hiragino Maru Gothic ProN', 'japanese'),
  face('ヒラギノ明朝 ProN', 'Hiragino Mincho ProN', 'japanese', 'serif'),
  face('游ゴシック', 'YuGothic', 'japanese'),
  face('游ゴシック', 'Yu Gothic', 'japanese'),
  face('游ゴシック UI', 'Yu Gothic UI', 'japanese'),
  face('游明朝', 'YuMincho', 'japanese', 'serif'),
  face('游明朝', 'Yu Mincho', 'japanese', 'serif'),
  face('Osaka', 'Osaka', 'japanese'),
  face('メイリオ', 'Meiryo', 'japanese'),
  face('MS Pゴシック', 'MS PGothic', 'japanese'),
  face('MS Pミンチョウ', 'MS PMincho', 'japanese', 'serif'),
  face('BIZ UDPゴシック', 'BIZ UDPGothic', 'japanese'),
  face('BIZ UDP明朝', 'BIZ UDPMincho', 'japanese', 'serif'),
  face('UD デジタル教科書体', 'UD Digi Kyokasho N-R', 'japanese'),

  /* ---- Latin: bundled first, then cross-platform, macOS, Windows ---- */
  bundledFace('Noto Sans', 'latin'),
  face('Arial', 'Arial', 'latin'),
  face('Verdana', 'Verdana', 'latin'),
  face('Tahoma', 'Tahoma', 'latin'),
  face('Trebuchet MS', 'Trebuchet MS', 'latin'),
  face('Impact', 'Impact', 'latin'),
  face('Times New Roman', 'Times New Roman', 'latin', 'serif'),
  face('Georgia', 'Georgia', 'latin', 'serif'),
  face('Courier New', 'Courier New', 'latin', 'monospace'),
  face('Helvetica Neue', 'Helvetica Neue', 'latin'),
  face('Helvetica', 'Helvetica', 'latin'),
  face('Avenir Next', 'Avenir Next', 'latin'),
  face('Futura', 'Futura', 'latin'),
  face('Optima', 'Optima', 'latin'),
  face('Gill Sans', 'Gill Sans', 'latin'),
  face('Palatino', 'Palatino', 'latin', 'serif'),
  face('Baskerville', 'Baskerville', 'latin', 'serif'),
  face('Didot', 'Didot', 'latin', 'serif'),
  face('Hoefler Text', 'Hoefler Text', 'latin', 'serif'),
  face('Menlo', 'Menlo', 'latin', 'monospace'),
  face('Monaco', 'Monaco', 'latin', 'monospace'),
  face('Segoe UI', 'Segoe UI', 'latin'),
  face('Calibri', 'Calibri', 'latin'),
  face('Candara', 'Candara', 'latin'),
  face('Century Gothic', 'Century Gothic', 'latin'),
  face('Franklin Gothic Medium', 'Franklin Gothic Medium', 'latin'),
  face('Cambria', 'Cambria', 'latin', 'serif'),
  face('Constantia', 'Constantia', 'latin', 'serif'),
  face('Garamond', 'Garamond', 'latin', 'serif'),
  face('Consolas', 'Consolas', 'latin', 'monospace'),
  face('Cascadia Code', 'Cascadia Code', 'latin', 'monospace'),
];

/**
 * Whether a family is installed, decided by whether asking for it changes the
 * width of a fixed run of text. A missing family falls through to the generic
 * behind it and measures exactly the same.
 */
export function isFontAvailable(family: string, measure: MeasureText): boolean {
  return GENERIC_BASELINES.some((generic) => {
    const baseline = measure(`${PROBE_SIZE_PX}px ${generic}`);
    if (baseline <= 0) return false;
    const candidate = measure(`${PROBE_SIZE_PX}px '${family}', ${generic}`);
    return Math.abs(candidate - baseline) > WIDTH_EPSILON;
  });
}

/** The generics a stack can end in. They always resolve, so they name nothing. */
const GENERICS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);

/**
 * The named faces in {@link DEFAULT_FONT_STACK}, in the order a browser tries
 * them. Read off the stack rather than written out again beside it, so the two
 * cannot drift apart.
 */
const DEFAULT_STACK_FAMILIES = DEFAULT_FONT_STACK.split(',')
  .map((part) => part.trim().replace(/^["']|["']$/g, ''))
  .filter((family) => !GENERICS.has(family));

/**
 * The catalog's own name for a family, so the default entry can borrow the one
 * the picker already shows for the face it lands on rather than inventing a
 * second spelling of ヒラギノ.
 */
const CATALOG_LABELS = new Map(FONT_CATALOG.map((choice) => [choice.probe, choice.label]));

/** The families that arrive with the app rather than with the machine. */
const BUNDLED = new Set<string>(BUNDLED_FONT_FAMILIES);

/**
 * The first family in a stack that this machine will actually draw with —
 * bundled or installed, in that order, because a bundled one settles the
 * question without measuring anything. `undefined` when the answer is only
 * whatever the trailing generic resolves to, which has no name worth showing.
 *
 * The order is the browser's own: it takes the first family it can resolve, not
 * the best one, so anything that wants to *name* what will be drawn has to walk
 * the stack the same way rather than pick a favourite out of it.
 */
export function firstResolvableFamily(
  families: string[],
  measure: MeasureText | null,
): string | undefined {
  return families.find(
    (family) => BUNDLED.has(family) || (measure !== null && isFontAvailable(family, measure)),
  );
}

/**
 * The one entry offered whatever this machine has, named after the face it
 * actually resolves to here.
 *
 * It is never probed away, which is easy to justify: the stack is a chain of
 * fallbacks ending in a generic, so it resolves to *something* everywhere. The
 * hard part was ever the label. It used to read `Noto Sans` unconditionally —
 * the first name in the chain — while no stock macOS install has Noto Sans, so
 * the head of the picker was the one entry naming a face the user did not have.
 * That is exactly what the rest of the catalog is probed to prevent, and the
 * thing this feature exists to stop: a name that silently resolves to something
 * else is how a deck changes appearance between machines without ever saying so.
 *
 * The fix then was to stop claiming it, and to name whichever face the chain
 * really landed on. The fix now is that **the claim is true** — Noto Sans ships
 * with the app (shared/bundledFonts.ts), so it heads the chain everywhere and
 * the entry reads 既定(Noto Sans) on every machine. The walk stays anyway: it is
 * what keeps the label honest if the stack is ever led by something unbundled.
 *
 * The name is kept inside 既定(…) rather than shown bare for two reasons: bare,
 * it would collide with that face's own catalog entry and the dedup below would
 * swallow one of them — and they are not the same choice, since this one writes
 * the whole fallback chain while that one pins a single family. And a closed
 * `<select>` shows the option without its group heading, so the label has to say
 * "the default" on its own.
 */
function defaultChoice(measure: MeasureText | null): FontChoice {
  const resolved = firstResolvableFamily(DEFAULT_STACK_FAMILIES, measure);
  const name = resolved ? (CATALOG_LABELS.get(resolved) ?? resolved) : null;
  return {
    label: name ? t('font.defaultNamed', { name }) : t('font.default'),
    stack: DEFAULT_FONT_STACK,
    group: 'default',
  };
}

/**
 * The catalog reduced to what this machine can render, led by the default
 * entry. Entries that share a label (the same typeface under its macOS and its
 * Windows name) collapse into whichever one is actually present. The bundled
 * faces pass through untouched — nothing about them is this machine's to decide.
 */
export function availableFonts(measure: MeasureText | null): FontChoice[] {
  const result: FontChoice[] = [defaultChoice(measure)];
  const seen = new Set<string>(result.map((choice) => choice.label));

  for (const choice of FONT_CATALOG) {
    if (seen.has(choice.label)) continue;
    // With no way to measure, absence cannot be proven, and a picker with one
    // entry in it is worse than one that occasionally offers a substitution.
    if (!choice.bundled && measure && !isFontAvailable(choice.probe, measure)) continue;
    seen.add(choice.label);
    result.push({ label: choice.label, stack: choice.stack, group: choice.group });
  }
  return result;
}

/** Canvas metrics, or `null` where there is no 2D context to measure with. */
export function canvasMeasure(): MeasureText | null {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return null;
  return (font) => {
    context.font = font;
    return context.measureText(PROBE_TEXT).width;
  };
}

let cached: FontChoice[] | null = null;

/**
 * The list the UI shows. Probing the whole catalog costs a few hundred text
 * measurements, and the set of installed fonts does not change while the app
 * runs, so it is done once.
 *
 * The cache now holds one translated string — the default entry's label — so a
 * language switched mid-session would leave that one word behind. There is one
 * catalog today and no switch to make; when a second language arrives, this is
 * a `cached = null` on the way through `setLocale`, not a reason to re-measure
 * every font on every render.
 */
export function usableFonts(): FontChoice[] {
  if (!cached) cached = availableFonts(canvasMeasure());
  return cached;
}

/**
 * The catalog entry a computed `font-family` corresponds to, matched on the
 * first family only: the browser rewrites quoting and the deck's own stack
 * rarely matches ours verbatim.
 */
export function matchFontStack(value: string, choices: FontChoice[] = usableFonts()): string | null {
  const first = firstFamily(value);
  if (!first) return null;
  return choices.find((choice) => firstFamily(choice.stack) === first)?.stack ?? null;
}

function firstFamily(value: string): string {
  return (value.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '').toLowerCase();
}
