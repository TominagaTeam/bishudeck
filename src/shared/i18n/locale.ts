/**
 * Which language the interface is in.
 *
 * A workspace preference rather than document content, so it lives next to the
 * window and never reaches the exported HTML — the same reasoning as pane
 * widths.
 */

export const LOCALES = ['ja', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * Each language named in itself, for the picker.
 *
 * Not catalog entries: an endonym reads the same whichever language the
 * interface is in, and it has to — a reader who cannot follow the current
 * language still needs to find their own in the list.
 */
export const LOCALE_NAMES: Record<Locale, string> = { ja: '日本語', en: 'English' };

/**
 * Where a machine whose language has no catalog lands. English rather than
 * Japanese, because it is the one a reader of any other language is likelier
 * to manage; a Japanese machine never gets here, since `ja` matches first.
 */
export const DEFAULT_LOCALE: Locale = 'en';

const STORAGE_KEY = 'hse.locale';

function isLocale(value: string | null): value is Locale {
  return value !== null && (LOCALES as readonly string[]).includes(value);
}

/**
 * An explicit choice wins over the machine's; the machine's wins over nothing.
 *
 * Only languages with a catalog are offered, so a French system falls back
 * rather than showing keys.
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

/**
 * Tells the platform which language the chrome is in.
 *
 * `<html lang>` is what a screen reader picks its voice by, and what a face
 * covering both scripts uses to choose between the Japanese and the Chinese
 * form of a shared Han character. Only this document: each slide is its own
 * document with its own `lang`, and nothing here touches it.
 */
export function publishLocale(locale: Locale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
}
