/**
 * Which language the interface is in.
 *
 * A workspace preference rather than document content, so it lives next to the
 * window and never reaches the exported HTML — the same reasoning as pane
 * widths.
 */

export const LOCALES = ['ja'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'ja';

const STORAGE_KEY = 'hse.locale';

function isLocale(value: string | null): value is Locale {
  return value !== null && (LOCALES as readonly string[]).includes(value);
}

/**
 * An explicit choice wins over the machine's; the machine's wins over nothing.
 *
 * Only languages with a catalog are offered, so a French system falls back
 * rather than showing keys. Today that means everything falls back to Japanese,
 * which is also what the fallback would be with a full set of catalogs missing
 * a match.
 */
export function resolveLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    // Private-mode storage failures are not worth failing to start over.
  }

  const preferred = typeof navigator === 'undefined' ? '' : navigator.language;
  const matched = LOCALES.find((locale) => preferred.toLowerCase().startsWith(locale));
  return matched ?? DEFAULT_LOCALE;
}

export function storeLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // As above.
  }
}
