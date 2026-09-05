/**
 * Interface text, looked up by key.
 *
 * Written by hand rather than pulled in: what this needs is a lookup and a
 * substitution, and `i18next` brings plurals, contexts, namespaces and lazy
 * loading that nothing here asks for.
 *
 * `t` is a plain function, not a hook, because command labels are interface
 * text that lives in `core/` — and `core` cannot depend on React. It reads the
 * catalog on every call so that switching languages is a matter of
 * re-rendering, not of reloading.
 */

import { en } from './en';
import { ja } from './ja';
import {
  DEFAULT_LOCALE,
  publishLocale,
  resolveLocale,
  storeLocale,
  type Locale,
} from './locale';

export type { Locale };
export { LOCALES, LOCALE_NAMES, DEFAULT_LOCALE, resolveLocale } from './locale';

/** Every key the interface can ask for. A typo is a compile error. */
export type MessageKey = keyof typeof ja;

/**
 * Catalogs are typed against the Japanese one, so a language added later cannot
 * ship with a key missing: the omission is a type error rather than a blank
 * label discovered by a user.
 */
export const CATALOGS: Record<Locale, Record<MessageKey, string>> = { ja, en };

let current: Locale = DEFAULT_LOCALE;

/** Called once as the app starts, before anything renders. */
export function initLocale(): Locale {
  current = resolveLocale();
  publishLocale(current);
  return current;
}

export function currentLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  current = locale;
  storeLocale(locale);
  publishLocale(locale);
}

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * The text for `key`, with any `{name}` filled in from `values`.
 *
 * A value that was not supplied leaves its placeholder in place rather than
 * emptying it: a visible `{count}` says which call is wrong, while a blank says
 * nothing and reads as a rendering bug.
 */
export function t(key: MessageKey, values?: Record<string, string | number>): string {
  const message = CATALOGS[current][key] ?? CATALOGS[DEFAULT_LOCALE][key] ?? key;
  if (!values) return message;
  return message.replace(PLACEHOLDER, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}
