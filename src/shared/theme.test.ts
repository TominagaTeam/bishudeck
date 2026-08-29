import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_THEME,
  applyTheme,
  readTheme,
  resolveTheme,
  storeTheme,
  watchSystemTheme,
} from './theme';

/** jsdom has no `matchMedia`, which is also the shape of a host that cannot
 *  answer — so the stub is opt-in and its absence is a case of its own. */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    matches,
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
  };
  vi.stubGlobal('matchMedia', () => query);
  return {
    listenerCount: () => listeners.size,
    flip(dark: boolean) {
      for (const listener of listeners) listener({ matches: dark } as MediaQueryListEvent);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

/**
 * The preference is the one thing a user cannot re-derive: a window that opens
 * in the wrong palette is wrong before anything is drawn.
 */
describe('the stored preference', () => {
  it('falls back to light rather than to the machine', () => {
    stubMatchMedia(true);
    expect(readTheme()).toBe('light');
    expect(DEFAULT_THEME).toBe('light');
  });

  it('keeps what was chosen', () => {
    storeTheme('dark');
    expect(readTheme()).toBe('dark');
    storeTheme('system');
    expect(readTheme()).toBe('system');
  });

  it('drops a value that is not a theme', () => {
    localStorage.setItem('hse.theme', 'solarized');
    expect(readTheme()).toBe('light');
  });
});

describe('resolving system', () => {
  it('asks the machine', () => {
    stubMatchMedia(true);
    expect(resolveTheme('system')).toBe('dark');
    stubMatchMedia(false);
    expect(resolveTheme('system')).toBe('light');
  });

  it('answers light where nothing can be asked', () => {
    expect(resolveTheme('system')).toBe('light');
  });

  it('leaves an explicit choice alone', () => {
    stubMatchMedia(true);
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });
});

/**
 * The stylesheet only knows `[data-theme='dark']`. If `system` ever reached the
 * attribute, the palette would have to be written twice — which is the drift
 * this resolution exists to prevent.
 */
describe('what reaches the document', () => {
  it('publishes the resolved palette, never the preference', () => {
    stubMatchMedia(true);
    expect(applyTheme('system')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    expect(applyTheme('light')).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('following the machine', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports a change and lets go on request', () => {
    const media = stubMatchMedia(false);
    const seen: string[] = [];
    const stop = watchSystemTheme((theme) => seen.push(theme));

    media.flip(true);
    media.flip(false);
    expect(seen).toEqual(['dark', 'light']);

    stop();
    expect(media.listenerCount()).toBe(0);
    media.flip(true);
    expect(seen).toEqual(['dark', 'light']);
  });

  it('is a no-op where nothing can be watched', () => {
    expect(() => watchSystemTheme(() => {})()).not.toThrow();
  });
});
