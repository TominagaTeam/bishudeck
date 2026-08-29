/**
 * The typefaces that travel with the app, and how a document gets at them.
 *
 * Everything else the picker offers belongs to the machine: the catalog in
 * `fonts.ts` is probed at runtime and a face that is not installed is hidden,
 * because offering one would let the browser silently substitute another and
 * change how the deck looks on the next machine. These two are the exception
 * that makes the rule workable — **they are installed by definition**, so the
 * default can name a real face instead of a hope.
 *
 * They are served from the preview origin (`slides://…/fonts/…`) rather than
 * from the app's own, because the preview frame is sandboxed without
 * `allow-same-origin` and is therefore an opaque origin. Tauri answers requests
 * for the frontend's files with `Access-Control-Allow-Origin: <window origin>`,
 * which an opaque origin never matches, so a font kept beside the frontend
 * would load while editing and quietly fail while presenting — the two views of
 * the same slide would not match. `slides://` answers `*`
 * (src-tauri/src/protocol.rs), so one URL serves all three documents: the app
 * window, the edit frame and the preview frame.
 */

import { assetBaseUrl } from './assetBase';

/**
 * The families `fonts.css` declares. Named here rather than read out of the
 * stylesheet because this list is what the picker offers unprobed, and a
 * mismatch would mean offering a face that does not arrive.
 */
export const BUNDLED_FONT_FAMILIES = ['Noto Sans', 'Noto Sans JP'] as const;

/** Marks the `<link>` this module adds, so a second call replaces nothing. */
export const BUNDLED_FONTS_ATTRIBUTE = 'data-hse-bundled-fonts';

const STYLESHEET_PATH = 'fonts/fonts.css';

/**
 * Where the `@font-face` declarations live, or `null` when there is no origin
 * to ask — running under `npm run dev` in a plain browser, where `slides://` is
 * not registered. Slides then draw in whatever the system has, which is exactly
 * what they did before any of this was bundled.
 */
export function bundledFontStylesheetUrl(baseUrl: string = assetBaseUrl()): string | null {
  const origin = baseUrl.replace(/\/+$/, '');
  return origin ? `${origin}/${STYLESHEET_PATH}` : null;
}

/**
 * Registers the bundled faces in a document.
 *
 * The app window needs this as much as the stage does: the font picker draws
 * each option in its own face, so a face the app window cannot see would be
 * offered under a preview of something else.
 */
export function attachBundledFonts(doc: Document, baseUrl?: string): boolean {
  const href = bundledFontStylesheetUrl(baseUrl);
  if (!href) return false;
  if (doc.querySelector(`link[${BUNDLED_FONTS_ATTRIBUTE}]`)) return true;

  const link = doc.createElement('link');
  link.setAttribute(BUNDLED_FONTS_ATTRIBUTE, '');
  link.rel = 'stylesheet';
  link.href = href;
  doc.head.append(link);
  return true;
}
