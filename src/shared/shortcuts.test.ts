import { describe, expect, it } from 'vitest';

import { classifyPlatform } from './platform';
import {
  SHORTCUTS,
  formatStroke,
  matchesShortcut,
  shortcutHint,
  shortcutKeys,
  shortcutsByGroup,
  strokeMatches,
  type ShortcutEntry,
  type Stroke,
} from './shortcuts';

/** `SHORTCUTS` is `as const` so the ids stay a union; the rows read as data here. */
const ENTRIES: readonly ShortcutEntry[] = SHORTCUTS;

function press(init: Partial<KeyboardEventInit> & { key?: string; code?: string }): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: '', code: '', ...init });
}

describe('matching', () => {
  it('accepts Command or Control for the same shortcut', () => {
    expect(matchesShortcut('edit.duplicate', press({ key: 'd', metaKey: true }))).toBe(true);
    expect(matchesShortcut('edit.duplicate', press({ key: 'd', ctrlKey: true }))).toBe(true);
    expect(matchesShortcut('edit.duplicate', press({ key: 'd' }))).toBe(false);
  });

  /** ⌘D duplicates the object and ⌘⇧D adds a slide: an unnamed modifier must be absent. */
  it('rejects a modifier the stroke does not name', () => {
    const shifted = press({ key: 'd', metaKey: true, shiftKey: true });
    expect(matchesShortcut('edit.duplicate', shifted)).toBe(false);
    expect(matchesShortcut('slide.add', shifted)).toBe(true);
    expect(matchesShortcut('slide.add', press({ key: 'd', metaKey: true }))).toBe(false);
  });

  /**
   * The element clipboard and the format painter sit one modifier apart, and on
   * Windows that modifier is Shift: ⌘C / Ctrl+C carries the object, ⌥⌘C /
   * Ctrl+⇧C carries only its look.
   */
  it('keeps the clipboard apart from the format painter', () => {
    expect(matchesShortcut('edit.copy', press({ key: 'c', metaKey: true }))).toBe(true);
    expect(matchesShortcut('edit.copyFormat', press({ key: 'c', metaKey: true }))).toBe(false);

    const shifted = press({ key: 'v', ctrlKey: true, shiftKey: true });
    expect(matchesShortcut('edit.paste', shifted)).toBe(false);
    expect(matchesShortcut('edit.pasteFormat', shifted)).toBe(true);
  });

  /** The bracket keys sit in the same place on JIS and US but type different characters. */
  it('matches layout-dependent keys on the physical key', () => {
    const jis = press({ key: '{', code: 'BracketRight', metaKey: true });
    expect(matchesShortcut('arrange.forward', jis)).toBe(true);
  });

  /** Shift on an arrow is a bigger step, not a different shortcut. */
  it("treats shift as 'either' where it only changes the degree", () => {
    expect(matchesShortcut('arrange.nudge', press({ key: 'ArrowLeft' }))).toBe(true);
    expect(matchesShortcut('arrange.nudge', press({ key: 'ArrowLeft', shiftKey: true }))).toBe(true);
    expect(matchesShortcut('select.next', press({ key: 'Tab', shiftKey: true }))).toBe(false);
    expect(matchesShortcut('select.prev', press({ key: 'Tab', shiftKey: true }))).toBe(true);
  });

  /** Display is filtered per platform; matching never is. */
  it('accepts the other convention’s spelling too', () => {
    expect(matchesShortcut('edit.redo', press({ key: 'y', metaKey: true }))).toBe(true);
    expect(shortcutKeys('edit.redo', 'mac')).toBe('⇧⌘Z');
    expect(shortcutKeys('edit.redo', 'pc')).toBe('Ctrl+Shift+Z / Ctrl+Y');
  });

  it('ignores a stroke with neither key nor code', () => {
    expect(strokeMatches({ mod: true } as Stroke, press({ key: 'a', metaKey: true }))).toBe(false);
  });
});

describe('display', () => {
  it('spells modifiers in each platform’s order', () => {
    const stroke: Stroke = { mod: true, shift: true, code: 'BracketRight' };
    expect(formatStroke(stroke, 'mac')).toBe('⇧⌘]');
    expect(formatStroke(stroke, 'pc')).toBe('Ctrl+Shift+]');
    expect(formatStroke({ mod: true, alt: true, key: 'c' }, 'mac')).toBe('⌥⌘C');
    expect(formatStroke({ key: 'ArrowLeft' }, 'pc')).toBe('←');
    expect(formatStroke({ key: 'Enter' }, 'mac')).toBe('Return');
    expect(formatStroke({ key: 'Enter' }, 'pc')).toBe('Enter');
  });

  it('hides the strokes that belong to the other convention', () => {
    expect(shortcutHint('edit.copyFormat', 'mac')).toBe('⌥⌘C');
    expect(shortcutHint('edit.copyFormat', 'pc')).toBe('Ctrl+Shift+C');
  });

  it('keeps keypad twins out of the sheet', () => {
    expect(shortcutKeys('view.zoomIn', 'mac')).toBe('⌘+');
  });
});

describe('the catalogue', () => {
  it('has no duplicate ids', () => {
    const ids = ENTRIES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * Two handlers may well answer the same key — Escape means something in the
   * stage and something else while presenting — but one handler answering it
   * twice is a shortcut that can never fire. Deliberate overlaps say so with
   * `contextual`, which is the point: an undeclared one fails here.
   */
  it('binds no key twice within one handler', () => {
    const seen = new Map<string, string>();
    for (const entry of ENTRIES) {
      // Declared overlaps are the handler's business; see `contextual`.
      if (entry.contextual) continue;
      for (const stroke of entry.strokes) {
        const key = [
          entry.owner,
          stroke.code ?? stroke.key?.toLowerCase(),
          stroke.mod ? 'mod' : '',
          stroke.shift === true ? 'shift' : '',
          stroke.alt ? 'alt' : '',
        ].join('|');
        expect(seen.has(key), `${entry.id} collides with ${seen.get(key)}`).toBe(false);
        seen.set(key, entry.id);
      }
    }
  });

  it('spells every entry on both platforms', () => {
    for (const entry of SHORTCUTS) {
      expect(shortcutKeys(entry.id, 'mac')).not.toBe('');
      expect(shortcutKeys(entry.id, 'pc')).not.toBe('');
    }
  });

  it('lists every entry in exactly one section', () => {
    const listed = shortcutsByGroup('mac').flatMap((section) => section.entries);
    expect(listed).toHaveLength(SHORTCUTS.length);
  });
});

describe('platform detection', () => {
  it('classifies the values navigator reports', () => {
    expect(classifyPlatform('MacIntel')).toBe('mac');
    expect(classifyPlatform('macOS')).toBe('mac');
    expect(classifyPlatform('Win32')).toBe('windows');
    expect(classifyPlatform('Windows')).toBe('windows');
    expect(classifyPlatform('Linux x86_64')).toBe('linux');
  });
});
