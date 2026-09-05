import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { en } from './en';
import { CATALOGS, LOCALES, setLocale, t } from './index';
import { ja } from './ja';
import { DEFAULT_LOCALE, resolveLocale } from './locale';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('t', () => {
  // Pinned rather than resolved: jsdom reports `en-US`, and these read the
  // Japanese entries by name.
  beforeEach(() => setLocale('ja'));

  it('returns the text for a key', () => {
    expect(t('command.editText')).toBe('テキストを編集');
  });

  it('fills placeholders from the values it is given', () => {
    expect(t('error.commandFailed', { label: '移動' })).toBe('移動 に失敗');
  });

  /**
   * A blank would read as a rendering bug and say nothing about which call is
   * wrong; a visible `{label}` names it.
   */
  it('leaves a placeholder alone when its value is missing', () => {
    expect(t('error.commandFailed', {})).toBe('{label} に失敗');
  });

  it('ignores values a message has no placeholder for', () => {
    expect(t('command.editText', { unused: 'x' })).toBe('テキストを編集');
  });

  it('reads the catalog of the language set last', () => {
    setLocale('en');
    expect(t('command.editText')).toBe('Edit text');
    expect(t('error.commandFailed', { label: 'Move' })).toBe('Move failed');
  });
});

describe.each(LOCALES)('the %s catalog', (locale) => {
  const catalog = CATALOGS[locale];

  it('has no entry that is still a placeholder', () => {
    const empty = Object.entries(catalog).filter(([, text]) => text.trim() === '');
    expect(empty).toEqual([]);
  });

  /**
   * Every `{name}` a message declares has to be one a caller can supply, and
   * the only way to see that here is that the braces are well formed — a stray
   * `{` would silently never be replaced.
   */
  it('has balanced placeholder braces everywhere', () => {
    const malformed = Object.entries(catalog).filter(
      ([, text]) => (text.match(/\{/g) ?? []).length !== (text.match(/\}/g) ?? []).length,
    );
    expect(malformed).toEqual([]);
  });
});

/**
 * The keys are one set by construction (the type), but two entries can agree on
 * the key and disagree on what goes into it: a `{count}` on one side and a
 * `{n}` on the other would leave one language showing its placeholder.
 */
describe('the catalogs together', () => {
  it('declare the same placeholders for every key', () => {
    const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const differing = (Object.keys(ja) as (keyof typeof ja)[]).filter(
      (key) => names(ja[key]).join() !== names(en[key]).join(),
    );
    expect(differing).toEqual([]);
  });
});

describe('resolveLocale', () => {
  function stubLanguage(language: string) {
    vi.stubGlobal('navigator', { language });
  }

  it('takes the machine language when it has a catalog', () => {
    stubLanguage('ja-JP');
    expect(resolveLocale()).toBe('ja');
    stubLanguage('en-GB');
    expect(resolveLocale()).toBe('en');
  });

  it('falls back to English for a language with no catalog', () => {
    stubLanguage('fr-FR');
    expect(resolveLocale()).toBe(DEFAULT_LOCALE);
    expect(DEFAULT_LOCALE).toBe('en');
  });

  it('lets a saved choice win over the machine', () => {
    stubLanguage('en-US');
    setLocale('ja');
    expect(resolveLocale()).toBe('ja');
  });

  it('ignores a saved value that is not a language it has', () => {
    stubLanguage('ja-JP');
    localStorage.setItem('hse.locale', 'fr');
    expect(resolveLocale()).toBe('ja');
  });

  it('publishes the language on the document', () => {
    setLocale('en');
    expect(document.documentElement.lang).toBe('en');
    setLocale('ja');
    expect(document.documentElement.lang).toBe('ja');
  });
});
