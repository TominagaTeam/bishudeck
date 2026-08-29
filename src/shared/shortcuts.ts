/**
 * The single source of truth for keyboard shortcuts.
 *
 * Holds the key definitions, their Japanese labels and how each one is spelled
 * per platform — and nothing else. The handlers stay where they are (`app/App`
 * for the application, `stage/EditStage` for the selection, `app/Present` for
 * the presentation window); they ask this module *whether* an event is a given
 * shortcut. Menus, the context menu and the help sheet ask it *how to write*
 * one. That is what stops the two from drifting apart, which is exactly what
 * happened while the key tests lived in the handlers and the ⌘ glyphs lived in
 * the menu components.
 *
 * It sits in `shared/` because all three of `app` / `features` / `stage` read
 * it, and that is the only direction the dependency rules allow
 * (`docs/basic-design/05-directory.md`).
 */

import { detectPlatform, type Platform } from './platform';
import { t, type MessageKey } from './i18n';

/** How keys are spelled. Linux borrows the PC spelling. */
export type KeyStyle = 'mac' | 'pc';

export function keyStyleFor(platform: Platform): KeyStyle {
  return platform === 'mac' ? 'mac' : 'pc';
}

let detected: KeyStyle | null = null;

/** The running environment's convention. Menus use it as their default. */
export function currentKeyStyle(): KeyStyle {
  detected ??= keyStyleFor(detectPlatform());
  return detected;
}

export interface Stroke {
  /**
   * The physical key, for keys whose character moves with the layout: brackets,
   * digits, minus and slash sit in the same place on JIS and US but produce
   * different characters, so matching on `key` would only work on one of them.
   */
  code?: string;
  /** The character, for everything else. Compared case-insensitively. */
  key?: string;
  /** ⌘ on macOS, Ctrl elsewhere. Matched as `metaKey || ctrlKey` — see below. */
  mod?: boolean;
  /**
   * `'either'` for keys where Shift changes the *degree* rather than the
   * meaning — the arrows nudge 1px, or 10px with Shift held, and both are the
   * same shortcut.
   */
  shift?: boolean | 'either';
  alt?: boolean;
  /**
   * Matches but is never listed: keypad twins and layout aliases, which are
   * worth accepting and not worth a row in the sheet.
   */
  hidden?: boolean;
  /**
   * Display filter. The stroke still *matches* everywhere; it is just not shown
   * outside its own convention — Ctrl+Y is how Windows spells redo, and putting
   * it in the macOS list would be noise.
   */
  only?: KeyStyle;
}

export type ShortcutGroup =
  | 'file'
  | 'edit'
  | 'arrange'
  | 'slide'
  | 'view'
  | 'select'
  | 'present'
  | 'help';

export interface ShortcutEntry {
  id: string;
  group: ShortcutGroup;
  readonly strokes: readonly Stroke[];
  /** Which handler implements it. Documentation, and a hint for the reader. */
  owner: 'app' | 'stage' | 'present';
  /**
   * The extra line the help sheet shows for keys whose meaning depends on
   * context. Spelled out rather than derived from the id, because only five
   * entries have one and `shortcut.${id}.note` cannot be proved to exist for
   * the rest without an `as` (docs/rules/development.md §5).
   */
  noteKey?: MessageKey;
  /**
   * Shares its keys with another entry on purpose, and the handler decides
   * between them — the arrows nudge the selection when there is one and page
   * the deck when there is not. Declared here so that every *other* collision
   * stays a test failure.
   */
  contextual?: boolean;
}


/** The order the help sheet lists the groups in. */
const GROUP_ORDER: ShortcutGroup[] = [
  'file',
  'edit',
  'arrange',
  'slide',
  'view',
  'select',
  'present',
  'help',
];

export const SHORTCUTS = [
  /* ------------------------------------------------------------------ file */
  { id: 'file.import', group: 'file', owner: 'app',
    strokes: [{ mod: true, key: 'o' }] },
  { id: 'file.export', group: 'file', owner: 'app',
    strokes: [{ mod: true, key: 's' }] },
  { id: 'file.exportAs', group: 'file', owner: 'app',
    strokes: [{ mod: true, shift: true, key: 's' }] },

  /* ------------------------------------------------------------------ edit */
  { id: 'edit.undo', group: 'edit', owner: 'app',
    strokes: [{ mod: true, key: 'z' }] },
  { id: 'edit.redo', group: 'edit', owner: 'app',
    strokes: [{ mod: true, shift: true, key: 'z' }, { mod: true, key: 'y', only: 'pc' }] },
  { id: 'edit.cut', group: 'edit', owner: 'app',
    strokes: [{ mod: true, key: 'x' }] },
  { id: 'edit.copy', group: 'edit', owner: 'app',
    strokes: [{ mod: true, key: 'c' }] },
  { id: 'edit.paste', group: 'edit', owner: 'app',
    noteKey: 'action.edit.paste.note',
    strokes: [{ mod: true, key: 'v' }] },
  { id: 'edit.duplicate', group: 'edit', owner: 'app',
    strokes: [{ mod: true, key: 'd' }] },
  { id: 'edit.delete', group: 'edit', owner: 'app',
    strokes: [{ key: 'Delete' }, { key: 'Backspace' }] },
  { id: 'edit.copyFormat', group: 'edit', owner: 'app',
    strokes: [
      { mod: true, alt: true, key: 'c', only: 'mac' },
      { mod: true, shift: true, key: 'c', only: 'pc' },
    ] },
  { id: 'edit.pasteFormat', group: 'edit', owner: 'app',
    strokes: [
      { mod: true, alt: true, key: 'v', only: 'mac' },
      { mod: true, shift: true, key: 'v', only: 'pc' },
    ] },

  /* --------------------------------------------------------------- arrange */
  { id: 'arrange.front', group: 'arrange', owner: 'app',
    strokes: [{ mod: true, shift: true, code: 'BracketRight' }] },
  { id: 'arrange.forward', group: 'arrange', owner: 'app',
    strokes: [{ mod: true, code: 'BracketRight' }] },
  { id: 'arrange.backward', group: 'arrange', owner: 'app',
    strokes: [{ mod: true, code: 'BracketLeft' }] },
  { id: 'arrange.back', group: 'arrange', owner: 'app',
    strokes: [{ mod: true, shift: true, code: 'BracketLeft' }] },
  { id: 'arrange.nudge', group: 'arrange', owner: 'app',
    noteKey: 'action.arrange.nudge.note', contextual: true,
    strokes: [
      { key: 'ArrowLeft', shift: 'either' },
      { key: 'ArrowRight', shift: 'either' },
      { key: 'ArrowUp', shift: 'either' },
      { key: 'ArrowDown', shift: 'either' },
    ] },

  /* ----------------------------------------------------------------- slide */
  { id: 'slide.add', group: 'slide', owner: 'app',
    noteKey: 'action.slide.add.note',
    strokes: [{ mod: true, key: 'm' }, { mod: true, shift: true, key: 'd' }] },

  /* ------------------------------------------------------------------ view */
  { id: 'view.nextSlide', group: 'view', owner: 'app',
    noteKey: 'action.view.nextSlide.note', contextual: true,
    strokes: [{ key: 'ArrowRight' }, { key: 'ArrowDown' }, { key: 'PageDown' }] },
  { id: 'view.prevSlide', group: 'view', owner: 'app',
    noteKey: 'action.view.prevSlide.note', contextual: true,
    strokes: [{ key: 'ArrowLeft' }, { key: 'ArrowUp' }, { key: 'PageUp' }] },
  { id: 'view.firstSlide', group: 'view', owner: 'app',
    strokes: [{ key: 'Home' }] },
  { id: 'view.lastSlide', group: 'view', owner: 'app',
    strokes: [{ key: 'End' }] },
  { id: 'view.zoomFit', group: 'view', owner: 'app',
    strokes: [{ mod: true, code: 'Digit0' }, { mod: true, code: 'Numpad0', hidden: true }] },
  { id: 'view.zoomIn', group: 'view', owner: 'app',
    strokes: [{ mod: true, code: 'Equal' }, { mod: true, code: 'NumpadAdd', hidden: true }] },
  { id: 'view.zoomOut', group: 'view', owner: 'app',
    strokes: [{ mod: true, code: 'Minus' }, { mod: true, code: 'NumpadSubtract', hidden: true }] },

  /* ---------------------------------------------------------------- select */
  { id: 'select.next', group: 'select', owner: 'stage',
    strokes: [{ key: 'Tab' }] },
  { id: 'select.prev', group: 'select', owner: 'stage',
    strokes: [{ key: 'Tab', shift: true }] },
  { id: 'select.editText', group: 'select', owner: 'stage',
    strokes: [{ key: 'Enter' }, { key: 'F2' }] },
  { id: 'select.escape', group: 'select', owner: 'stage',
    noteKey: 'action.select.escape.note',
    strokes: [{ key: 'Escape' }] },

  /* --------------------------------------------------------------- present */
  { id: 'present.start', group: 'present', owner: 'app',
    strokes: [{ key: 'F5' }, { mod: true, shift: true, key: 'Enter' }] },
  { id: 'present.next', group: 'present', owner: 'present',
    strokes: [
      { key: 'ArrowRight' }, { key: 'ArrowDown' }, { key: 'PageDown' }, { key: ' ' },
    ] },
  { id: 'present.prev', group: 'present', owner: 'present',
    strokes: [{ key: 'ArrowLeft' }, { key: 'ArrowUp' }, { key: 'PageUp' }] },
  { id: 'present.first', group: 'present', owner: 'present',
    strokes: [{ key: 'Home' }] },
  { id: 'present.last', group: 'present', owner: 'present',
    strokes: [{ key: 'End' }] },
  { id: 'present.end', group: 'present', owner: 'present',
    strokes: [{ key: 'Escape' }] },

  /* ------------------------------------------------------------------ help */
  { id: 'help.shortcuts', group: 'help', owner: 'app',
    strokes: [{ mod: true, code: 'Slash' }, { key: 'F1', only: 'pc' }] },
] as const satisfies readonly ShortcutEntry[];

export type ShortcutId = (typeof SHORTCUTS)[number]['id'];

const BY_ID = new Map<string, ShortcutEntry>(SHORTCUTS.map((entry) => [entry.id, entry]));

export function shortcutEntry(id: ShortcutId): ShortcutEntry {
  const entry = BY_ID.get(id);
  // Unreachable through `ShortcutId`, but the map is built at runtime and the
  // catalogue is edited by hand.
  if (!entry) throw new Error(`unknown shortcut: ${id}`);
  return entry;
}

/* ------------------------------------------------------------------ matching */

/**
 * Matching is forgiving where display is strict: `mod` accepts Command *or*
 * Control on every platform. Mac users who reach for Ctrl out of habit get the
 * shortcut, and the modifier a stroke does not name has to be absent — that is
 * what keeps ⌘D (duplicate the object) apart from ⌘⇧D (add a slide).
 */
export function strokeMatches(stroke: Stroke, event: KeyboardEvent): boolean {
  const mod = event.metaKey || event.ctrlKey;
  if (mod !== Boolean(stroke.mod)) return false;
  if (stroke.shift !== 'either' && event.shiftKey !== Boolean(stroke.shift)) return false;
  if (event.altKey !== Boolean(stroke.alt)) return false;
  if (stroke.code) return event.code === stroke.code;
  if (stroke.key) return event.key.toLowerCase() === stroke.key.toLowerCase();
  return false;
}

export function matchesShortcut(id: ShortcutId, event: KeyboardEvent): boolean {
  return shortcutEntry(id).strokes.some((stroke) => strokeMatches(stroke, event));
}

/* ------------------------------------------------------------------- display */

/** Physical keys whose character the label has to spell out. */
const CODE_LABELS: Record<string, string> = {
  BracketRight: ']',
  BracketLeft: '[',
  Digit0: '0',
  Equal: '+',
  Minus: '−',
  Slash: '/',
};

const KEY_LABELS: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ' ': 'Space',
  Escape: 'Esc',
};

function keyLabel(stroke: Stroke, style: KeyStyle): string {
  if (stroke.code) return CODE_LABELS[stroke.code] ?? stroke.code;
  const key = stroke.key ?? '';
  // The Return key is spelled that way on Apple keyboards and Enter elsewhere.
  if (key === 'Enter') return style === 'mac' ? 'Return' : 'Enter';
  return KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

/** `⇧⌘]` on macOS (Apple's ⌃⌥⇧⌘ order), `Ctrl+Shift+]` elsewhere. */
export function formatStroke(stroke: Stroke, style: KeyStyle): string {
  const key = keyLabel(stroke, style);
  const shift = stroke.shift === true;
  if (style === 'mac') {
    return `${stroke.alt ? '⌥' : ''}${shift ? '⇧' : ''}${stroke.mod ? '⌘' : ''}${key}`;
  }
  const parts: string[] = [];
  if (stroke.mod) parts.push('Ctrl');
  if (stroke.alt) parts.push('Alt');
  if (shift) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

function visibleStrokes(entry: ShortcutEntry, style: KeyStyle): readonly Stroke[] {
  const shown = entry.strokes.filter(
    (stroke) => !stroke.hidden && (!stroke.only || stroke.only === style),
  );
  // A key spelled for one convention only still needs a row on the other, or
  // the entry would silently vanish from that platform's sheet.
  return shown.length > 0 ? shown : entry.strokes;
}

/** One spelling, for a menu item's `<kbd>`. */
export function shortcutHint(id: ShortcutId, style: KeyStyle = currentKeyStyle()): string {
  return formatStroke(visibleStrokes(shortcutEntry(id), style)[0], style);
}

/** Every spelling, for the help sheet. */
export function shortcutKeys(id: ShortcutId, style: KeyStyle = currentKeyStyle()): string {
  return visibleStrokes(shortcutEntry(id), style)
    .map((stroke) => formatStroke(stroke, style))
    .join(' / ');
}

export interface ShortcutSection {
  group: ShortcutGroup;
  label: string;
  entries: { entry: ShortcutEntry; label: string; note: string | null; keys: string }[];
}

/**
 * The help sheet's rows, resolved into the current language.
 *
 * Names are looked up from each entry's own id rather than stored beside it:
 * `select.escape` is both what the handler matches on and what the catalog is
 * keyed by, so there is one name for the thing and no way for a table and a
 * catalog to disagree about it.
 */
export function shortcutsByGroup(style: KeyStyle): ShortcutSection[] {
  return GROUP_ORDER.map((group) => ({
    group,
    label: t(`shortcut.group.${group}`),
    entries: SHORTCUTS.filter((entry) => entry.group === group).map((entry) => ({
      entry,
      label: t(`action.${entry.id}`),
      note: 'noteKey' in entry && entry.noteKey ? t(entry.noteKey) : null,
      keys: shortcutKeys(entry.id, style),
    })),
  })).filter((section) => section.entries.length > 0);
}
