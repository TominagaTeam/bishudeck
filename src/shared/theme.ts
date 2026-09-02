/**
 * Which palette the application's own chrome is painted in.
 *
 * A workspace preference rather than document content, so it lives beside the
 * window and never reaches the exported HTML — the same shelf as pane widths
 * and the interface language.
 *
 * Only the chrome moves. The overlay the editor draws over a slide keeps its
 * colours: those are picked to read against
 * the deck's own background, which has nothing to do with the palette the
 * window happens to be wearing.
 */

export const THEMES = ['system', 'light', 'dark'] as const;

export type ThemePreference = (typeof THEMES)[number];

/** What `system` resolves to, and the only two the stylesheet knows about. */
export type Theme = Exclude<ThemePreference, 'system'>;

/** Light rather than the machine's setting. A slide is pale, so the editor is
 *  pale by default and the chrome stays out of the way of the thing being
 *  edited. Following the OS stays available — as a choice the user makes,
 *  not as the one they are handed. */
export const DEFAULT_THEME: ThemePreference = 'light';

const STORAGE_KEY = 'hse.theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Where the resolved theme is published. `:root[data-theme='dark']` is the
 *  only selector the stylesheet needs, because `system` never reaches it. */
const THEME_ATTRIBUTE = 'theme';

function isThemePreference(value: string | null): value is ThemePreference {
  return value !== null && (THEMES as readonly string[]).includes(value);
}

/** `matchMedia` is missing under jsdom and in any host without a display, and
 *  neither is a reason to fail to start: no answer means light. */
function darkQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(DARK_QUERY);
}

/**
 * The stored preference, or the default.
 *
 * Unlike the interface language (`i18n/locale.ts`), the machine's own setting
 * is not consulted here: `system` is one of the three answers rather than the
 * fallback, so a user who never opens the menu gets light.
 */
export function readTheme(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isThemePreference(saved)) return saved;
  } catch {
    // Private-mode storage failures are not worth failing to start over.
  }
  return DEFAULT_THEME;
}

export function storeTheme(preference: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // As above.
  }
}

/** The palette to paint, with `system` asked of the machine. */
export function resolveTheme(preference: ThemePreference): Theme {
  if (preference !== 'system') return preference;
  return darkQuery()?.matches ? 'dark' : 'light';
}

/**
 * Paints `preference` and answers what it came out as.
 *
 * The attribute carries the *resolved* theme rather than the preference, so
 * the stylesheet holds one block per palette. Publishing `system` would mean
 * repeating the whole dark palette inside a `prefers-color-scheme` query —
 * two copies of the same twenty tokens, which is exactly the drift this file
 * exists to prevent.
 */
export function applyTheme(preference: ThemePreference): Theme {
  const theme = resolveTheme(preference);
  document.documentElement.dataset[THEME_ATTRIBUTE] = theme;
  return theme;
}

/** Called once as the app starts, before anything renders — a window that
 *  paints light and then turns dark has already been seen. */
export function applyStoredTheme(): Theme {
  return applyTheme(readTheme());
}

/** Holds every query that still has a listener on it.
 *
 *  A `MediaQueryList` nothing references may be collected, and the listener
 *  goes with it — the caller here throws the handle away, so this is the only
 *  thing keeping it alive. Cheap insurance: the whole feature would fail
 *  silently and only on some builds. */
const watched = new Set<MediaQueryList>();

/**
 * Follows the machine while `system` is the preference.
 *
 * The listener stays registered whatever the preference is, because the OS can
 * flip at any time (a sunset schedule, another app) and the answer has to be
 * right the moment `system` is chosen again. The caller decides whether the
 * change means anything.
 */
export function watchSystemTheme(onChange: (theme: Theme) => void): () => void {
  const query = darkQuery();
  if (!query) return () => {};
  const listener = (event: MediaQueryListEvent) => onChange(event.matches ? 'dark' : 'light');
  query.addEventListener('change', listener);
  watched.add(query);
  return () => {
    query.removeEventListener('change', listener);
    watched.delete(query);
  };
}
