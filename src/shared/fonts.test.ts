import { beforeEach, describe, expect, it } from 'vitest';

import { BUNDLED_FONT_FAMILIES } from './bundledFonts';
import {
  DEFAULT_FONT_STACK,
  FONT_CATALOG,
  availableFonts,
  firstResolvableFamily,
  isFontAvailable,
  matchFontStack,
  type MeasureText,
} from './fonts';
import { setLocale, t } from './i18n';

// The names below are the Japanese ones; jsdom would otherwise report `en-US`.
beforeEach(() => setLocale('ja'));

/**
 * Stands in for canvas metrics: only the families listed as installed widen the
 * run, exactly as a real font engine falling through to the generic behaves.
 */
function measurerWith(installed: string[]): MeasureText {
  return (font) => {
    const families = font.slice(font.indexOf('px ') + 3).split(',');
    const requested = families[0].trim().replace(/^'|'$/g, '');
    return installed.includes(requested) ? 200 : 100;
  };
}

describe('font availability', () => {
  it('reports an installed family as available', () => {
    expect(isFontAvailable('Meiryo', measurerWith(['Meiryo']))).toBe(true);
  });

  it('reports a family that falls through to the generic as unavailable', () => {
    expect(isFontAvailable('Meiryo', measurerWith([]))).toBe(false);
  });

  it('treats a zero-width measurement as no evidence', () => {
    expect(isFontAvailable('Meiryo', () => 0)).toBe(false);
  });
});

describe('availableFonts', () => {
  it('hides families this machine does not have', () => {
    const fonts = availableFonts(measurerWith(['Hiragino Sans']));
    const labels = fonts.map((f) => f.label);
    expect(labels).toContain('ヒラギノ角ゴシック');
    expect(labels).not.toContain('メイリオ');
  });

  it('always offers the default stack, which is never probed', () => {
    const [first] = availableFonts(measurerWith([]));
    expect(first.stack).toBe(DEFAULT_FONT_STACK);
  });

  it('offers the app’s own faces on a machine that has nothing installed', () => {
    // The floor of the picker. Everything else here belongs to the operating
    // system and can be absent; these ship with the app (bundledFonts.ts), so
    // this is the shortest the list ever gets.
    const labels = availableFonts(measurerWith([])).map((f) => f.label);
    expect(labels).toEqual([
      t('font.defaultNamed', { name: 'Noto Sans' }),
      ...[...BUNDLED_FONT_FAMILIES].sort(
        (a, b) => FONT_CATALOG.findIndex((c) => c.labels.ja === a) - FONT_CATALOG.findIndex((c) => c.labels.ja === b),
      ),
    ]);
  });

  it('has a catalog entry for every bundled family, and probes none of them', () => {
    for (const family of BUNDLED_FONT_FAMILIES) {
      const entry = FONT_CATALOG.find((c) => c.labels.ja === family);
      expect(entry, `${family} is served but never offered`).toBeDefined();
      expect(entry?.bundled, `${family} would be probed away`).toBe(true);
    }
  });

  it('collapses the macOS and Windows names of one typeface into a single entry', () => {
    // 游ゴシック ships as YuGothic on macOS and Yu Gothic on Windows.
    const both = availableFonts(measurerWith(['YuGothic', 'Yu Gothic']));
    expect(both.filter((f) => f.label === '游ゴシック')).toHaveLength(1);

    const windowsOnly = availableFonts(measurerWith(['Yu Gothic']));
    expect(windowsOnly.find((f) => f.label === '游ゴシック')?.stack).toContain("'Yu Gothic'");
  });

  it('offers the whole catalog when there is nothing to measure with', () => {
    expect(availableFonts(null).length).toBeGreaterThan(FONT_CATALOG.length / 2);
  });

  it('names a Japanese face the way an English system does', () => {
    // The alias its vendor uses, not a translation: what an English macOS
    // lists ヒラギノ角ゴシック as.
    setLocale('en');
    const labels = availableFonts(measurerWith(['Hiragino Sans'])).map((f) => f.label);
    expect(labels).toContain('Hiragino Sans');
    expect(labels).not.toContain('ヒラギノ角ゴシック');
    // The head of the list is translated with it.
    expect(labels[0]).toBe('Default (Noto Sans)');
  });

  it('still folds the macOS and Windows names into one entry in English', () => {
    setLocale('en');
    const both = availableFonts(measurerWith(['YuGothic', 'Yu Gothic']));
    expect(both.filter((f) => f.label === 'Yu Gothic')).toHaveLength(1);
  });

  it('gives every face a name in every language', () => {
    for (const entry of FONT_CATALOG) {
      expect(entry.labels.ja.trim(), entry.probe).not.toBe('');
      expect(entry.labels.en.trim(), entry.probe).not.toBe('');
    }
  });
});

/**
 * What the head of the picker is allowed to call itself.
 *
 * The rest of the catalog is probed so that no entry names a face this machine
 * does not have — a name that silently resolves to something else is how a deck
 * changes appearance between machines without saying so, which is the whole
 * reason this module measures anything. The default entry sat outside it: it is
 * offered unprobed (correctly — its stack ends in a generic, so it always
 * resolves), and it was *labelled* after the head of that stack. Measured on
 * this Mac, `Noto Sans` was not installed, so the one entry breaking the rule
 * sat at the top of the list and read as a face the user could not have.
 *
 * Bundling the face is what settled it (src-tauri/fonts/). The label reads
 * `Noto Sans` again — but because the claim became true, not because the check
 * was dropped: the walk below still refuses to name anything it cannot account
 * for.
 */
describe('the default entry', () => {
  const chain = DEFAULT_FONT_STACK.split(',').map((part) => part.trim().replace(/'/g, ''));

  it('is named after the face it actually resolves to here', () => {
    // Nothing but ヒラギノ installed, and the head of the picker still reads
    // Noto Sans: the app brought its own copy, so that is what gets drawn.
    const [first] = availableFonts(measurerWith(['Hiragino Sans']));
    expect(first.label).toBe(t('font.defaultNamed', { name: 'Noto Sans' }));
    expect(chain[0]).toBe('Noto Sans');
  });

  it('still writes the whole chain, head and all', () => {
    const [first] = availableFonts(measurerWith(['Hiragino Sans']));
    expect(first.stack).toBe(DEFAULT_FONT_STACK);
    // The tail is not decoration now that the head ships with the app: an
    // exported deck gets opened where this app is not, and there the system
    // faces behind it are all there is.
    expect(chain).toContain('Hiragino Sans');
  });

  it('leaves the face it borrowed its name from standing on its own', () => {
    // They are not the same choice: this one writes the fallback chain, that
    // one pins a single family. Keeping the name inside 既定(…) is what stops
    // the dedup in `availableFonts` from swallowing one of them.
    const fonts = availableFonts(measurerWith(['Hiragino Sans']));
    const pinned = fonts.find((f) => f.label === 'Noto Sans');
    expect(pinned?.stack).toBe("'Noto Sans', sans-serif");
    expect(fonts[0].stack).not.toBe(pinned?.stack);
  });

  it('leaves no entry in the list naming a face that is not here', () => {
    // The invariant the picker is for, asserted over the whole list rather
    // than one entry at a time: every entry is either probed and found, or
    // shipped with the app.
    const measure = measurerWith(['Hiragino Sans', 'YuGothic', 'Arial', 'Menlo']);
    // Keyed by stack, not by label: 游ゴシック wears two probes (YuGothic and
    // Yu Gothic) and only one of them is here, which is the very case the
    // dedup exists for.
    const behind = new Map(FONT_CATALOG.map((c) => [c.stack, c] as const));
    const here = (entry: (typeof FONT_CATALOG)[number]) =>
      entry.bundled === true || isFontAvailable(entry.probe, measure);
    const [first, ...rest] = availableFonts(measure);

    // Unwrap 既定(名前) and find the catalog entry that name belongs to.
    const borrowed = first.label.replace(/^.*\(|\)$/g, '');
    const source = FONT_CATALOG.find((c) => c.labels.ja === borrowed && here(c));
    expect(source, `${first.label} names a face that is not here`).toBeDefined();

    for (const choice of rest) {
      const entry = behind.get(choice.stack);
      expect(entry, `nothing in the catalog behind ${choice.label}`).toBeDefined();
      expect(here(entry!), `${choice.label} is not here`).toBe(true);
    }
  });
});

/**
 * Naming what a stack will really be drawn with — the walk behind the default
 * entry's label, and the only place the two kinds of face meet.
 */
describe('firstResolvableFamily', () => {
  it('takes a bundled family without measuring anything', () => {
    // Installed or not is not a question that applies: it came with the app.
    expect(firstResolvableFamily(['Noto Sans', 'Meiryo'], measurerWith(['Meiryo']))).toBe('Noto Sans');
    expect(firstResolvableFamily(['Noto Sans'], null)).toBe('Noto Sans');
  });

  it('walks in the browser’s order rather than taking any installed face', () => {
    const both = measurerWith(['Meiryo', 'Hiragino Sans']);
    expect(firstResolvableFamily(['Meiryo', 'Hiragino Sans'], both)).toBe('Meiryo');
    expect(firstResolvableFamily(['Hiragino Sans', 'Meiryo'], both)).toBe('Hiragino Sans');
  });

  it('steps over a family this machine cannot draw', () => {
    expect(firstResolvableFamily(['Meiryo', 'Hiragino Sans'], measurerWith(['Hiragino Sans']))).toBe(
      'Hiragino Sans',
    );
  });

  it('names nothing when only the generic is left', () => {
    // The stack still resolves — it ends in one — but there is no honest name
    // to put in the brackets, so none is put there.
    expect(firstResolvableFamily(['Meiryo'], measurerWith([]))).toBeUndefined();
    // Same answer with no way to measure: absence is not proven either.
    expect(firstResolvableFamily(['Meiryo'], null)).toBeUndefined();
  });
});

describe('matchFontStack', () => {
  const choices = availableFonts(measurerWith(['Meiryo']));

  it('matches a computed value back to the catalog entry', () => {
    expect(matchFontStack('Meiryo, sans-serif', choices)).toBe("'Meiryo', sans-serif");
    // Engines re-quote computed values; matching is on the first family only.
    expect(matchFontStack('"Meiryo", "Segoe UI", sans-serif', choices)).toBe("'Meiryo', sans-serif");
  });

  it('returns null for a family the picker does not offer', () => {
    expect(matchFontStack('Comic Sans MS, cursive', choices)).toBeNull();
    expect(matchFontStack('', choices)).toBeNull();
  });
});
