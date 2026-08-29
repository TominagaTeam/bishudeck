import { describe, expect, it } from 'vitest';

import { t } from './index';
import { ja } from './ja';

describe('t', () => {
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
});

describe('the Japanese catalog', () => {
  it('has no entry that is still a placeholder', () => {
    const empty = Object.entries(ja).filter(([, text]) => text.trim() === '');
    expect(empty).toEqual([]);
  });

  /**
   * Every `{name}` a message declares has to be one a caller can supply, and
   * the only way to see that here is that the braces are well formed — a stray
   * `{` would silently never be replaced.
   */
  it('has balanced placeholder braces everywhere', () => {
    const malformed = Object.entries(ja).filter(
      ([, text]) => (text.match(/\{/g) ?? []).length !== (text.match(/\}/g) ?? []).length,
    );
    expect(malformed).toEqual([]);
  });
});
