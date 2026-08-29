import { create } from 'zustand';

import { editorEvents } from '../core/events/bus';
import type { MessageKey } from '../shared/i18n';
import {
  applyTheme,
  readTheme,
  storeTheme,
  watchSystemTheme,
  type ThemePreference,
} from '../shared/theme';

/** Zoom levels the status bar offers and the keyboard shortcuts step through. */
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2];

export type StageMode = 'edit' | 'preview';

/** The two panes flanking the canvas. Both resize and collapse the same way,
 *  so everything that differs between them lives here rather than in the
 *  divider that reads it. */
export type PaneId = 'slideList' | 'inspector';

/** Bounds are per-pane because the panes hold different things: a thumbnail
 *  stops being readable below 160px, while the inspector's label+field rows
 *  (`.field` is a 56px label plus the control) break up below 240px. Wider
 *  than the max and the canvas loses more than the pane gains.
 *
 *  Pane geometry is a workspace preference, not document state, so it lives
 *  next to the window rather than in the project file. The slide list keeps
 *  its original storage key so preferences saved before the inspector became
 *  resizable still load. */
export const PANES = {
  slideList: {
    side: 'left',
    nameKey: 'pane.slideList',
    min: 160,
    max: 480,
    def: 240,
    storageKey: 'hse.slideListPane',
  },
  inspector: {
    side: 'right',
    nameKey: 'pane.inspector',
    min: 240,
    max: 520,
    def: 280,
    storageKey: 'hse.inspectorPane',
  },
} as const satisfies Record<PaneId, PaneSpec>;

interface PaneSpec {
  /** Which edge of the workspace the pane is pinned to. The divider measures
   *  the drag from that edge; the stylesheet mirrors the chevron across it. */
  side: 'left' | 'right';
  /** What the pane is called, for the divider's labels. */
  nameKey: MessageKey;
  min: number;
  max: number;
  def: number;
  storageKey: string;
}

/** Where the inspector's fold state goes. Same category as pane geometry — a
 *  workspace preference rather than anything about the deck — so it sits beside
 *  it rather than in the project file. */
export const INSPECTOR_PANELS_KEY = 'hse.inspectorPanels';

interface UiState {
  mode: StageMode;
  slideIndex: number;
  /** `null` = fit to the available canvas area. */
  zoomOverride: number | null;
  busy: string | null;
  toast: { kind: 'info' | 'error'; message: string } | null;
  /** When the document last reached disk, autosaved or not. */
  savedAt: number | null;
  panes: Record<PaneId, PaneState>;
  /** Which inspector panels the user has opened or folded **by hand**.
   *
   *  Only those. A panel with no entry here follows the per-kind layout table
   *  (`features/inspectorLayout.ts`), and that is the point: recording a state
   *  for every panel would mean one click on 枠線 froze the whole column, and
   *  selecting a photo would stop bringing 画像 to the top ever again.
   *
   *  Keyed by plain string because the dependency direction is
   *  `features → app`: the store cannot name the inspector's panels without
   *  inverting it. Every call site passes a `PanelId`. */
  inspectorPanels: Record<string, boolean>;
  /** Which palette the chrome is painted in (`shared/theme.ts`). The same
   *  category of preference as the pane geometry above it — about the window
   *  rather than about the deck — so it is stored the same way and never
   *  reaches the exported HTML. */
  theme: ThemePreference;
  /** The keyboard shortcut sheet. Opened from the toolbar and from ⌘/. */
  helpOpen: boolean;

  setMode(mode: StageMode): void;
  setSlideIndex(index: number): void;
  step(delta: number, slideCount: number): void;
  setZoomOverride(zoom: number | null): void;
  setBusy(label: string | null): void;
  notify(kind: 'info' | 'error', message: string): void;
  dismissToast(): void;
  setPaneWidth(pane: PaneId, width: number): void;
  togglePane(pane: PaneId, collapsed?: boolean): void;
  setInspectorPanel(id: string, open: boolean): void;
  setTheme(theme: ThemePreference): void;
  setHelpOpen(open: boolean): void;
}

interface PaneState {
  width: number;
  collapsed: boolean;
}

function readPane(pane: PaneId): PaneState {
  try {
    const raw = localStorage.getItem(PANES[pane].storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PaneState>;
      return {
        width: clampPaneWidth(pane, Number(parsed.width) || PANES[pane].def),
        collapsed: parsed.collapsed === true,
      };
    }
  } catch {
    // A stored preference is never worth failing to start over.
  }
  return { width: PANES[pane].def, collapsed: false };
}

/**
 * The folds the user set last time, with anything unrecognisable dropped.
 *
 * Entries are filtered rather than trusted wholesale because the keys are panel
 * ids: a build that renames or removes one would otherwise keep resurrecting a
 * fold state for a panel that no longer exists. An empty map is always a valid
 * answer — it just means every panel follows its per-kind default.
 */
function readInspectorPanels(): Record<string, boolean> {
  const panels: Record<string, boolean> = {};
  try {
    const raw = localStorage.getItem(INSPECTOR_PANELS_KEY);
    if (raw) {
      for (const [id, open] of Object.entries(JSON.parse(raw) as Record<string, unknown>)) {
        if (typeof open === 'boolean') panels[id] = open;
      }
    }
  } catch {
    // A stored preference is never worth failing to start over.
  }
  return panels;
}

/**
 * Dragging a seam calls `setPaneWidth` on every pixel of pointer movement, and
 * with two panes that is two synchronous `localStorage` writes per frame. The
 * store's own state stays synchronous — the pane must not lag the pointer — and
 * only the trip to disk is deferred, so the last width of a drag is the one
 * that gets written.
 *
 * The inspector's folds ride the same queue. They arrive one click at a time
 * rather than sixty a second, but sharing the queue is what gives them the
 * `pagehide` flush below for free — a preference set in the last second before
 * the window closes is exactly the one a user would notice missing.
 */
const PREFERENCE_PERSIST_DEBOUNCE_MS = 200;

/** Keyed by storage key rather than by what the value means, so one queue can
 *  hold both panes and folds. */
const pendingPreferences = new Map<string, unknown>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function persistPreference(storageKey: string, value: unknown): void {
  pendingPreferences.set(storageKey, value);
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(flushPreferences, PREFERENCE_PERSIST_DEBOUNCE_MS);
}

/** Exported for the test and for the unload hook; nothing else should call it. */
export function flushPreferences(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  for (const [storageKey, value] of pendingPreferences) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Private-mode storage failures are not worth a toast.
    }
  }
  pendingPreferences.clear();
}

// A window closed mid-debounce would otherwise lose the last drag. `pagehide`
// rather than `beforeunload`: it is the one the WebView actually fires on quit.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushPreferences);
}

export function clampPaneWidth(pane: PaneId, width: number): number {
  const { min, max } = PANES[pane];
  return Math.min(Math.max(Math.round(width), min), max);
}

const initialPanes: Record<PaneId, PaneState> = {
  slideList: readPane('slideList'),
  inspector: readPane('inspector'),
};

export const useUiStore = create<UiState>((set, get) => ({
  // Editing is what the app is for; preview is where you go to check the
  // result. A deck that opens in preview asks for a click before it can be
  // touched, every time.
  mode: 'edit',
  slideIndex: 0,
  zoomOverride: null,
  busy: null,
  toast: null,
  savedAt: null,
  panes: initialPanes,
  inspectorPanels: readInspectorPanels(),
  theme: readTheme(),
  helpOpen: false,

  setMode(mode) {
    if (get().mode === mode) return;
    set({ mode });
    editorEvents.emit('mode:changed', { mode });
  },

  setSlideIndex(index) {
    if (get().slideIndex === index) return;
    set({ slideIndex: index });
    editorEvents.emit('slide:changed', { index });
  },

  step(delta, slideCount) {
    if (slideCount === 0) return;
    const next = Math.min(Math.max(get().slideIndex + delta, 0), slideCount - 1);
    get().setSlideIndex(next);
  },

  setZoomOverride(zoomOverride) {
    set({ zoomOverride });
  },

  setBusy(busy) {
    set({ busy });
  },

  notify(kind, message) {
    set({ toast: { kind, message } });
  },

  dismissToast() {
    set({ toast: null });
  },

  setPaneWidth(pane, width) {
    const current = get().panes[pane];
    const next = { ...current, width: clampPaneWidth(pane, width) };
    if (next.width === current.width) return;
    set({ panes: { ...get().panes, [pane]: next } });
    persistPreference(PANES[pane].storageKey, next);
  },

  togglePane(pane, collapsed) {
    const current = get().panes[pane];
    const next = { ...current, collapsed: collapsed ?? !current.collapsed };
    if (next.collapsed === current.collapsed) return;
    set({ panes: { ...get().panes, [pane]: next } });
    persistPreference(PANES[pane].storageKey, next);
  },

  setInspectorPanel(id, open) {
    const current = get().inspectorPanels;
    if (current[id] === open) return;
    const next = { ...current, [id]: open };
    set({ inspectorPanels: next });
    persistPreference(INSPECTOR_PANELS_KEY, next);
  },

  // Painted and stored on the spot rather than through the debounced queue
  // above: this arrives one click at a time, and the attribute has to be on
  // the document before the next frame.
  setTheme(theme) {
    if (get().theme === theme) return;
    set({ theme });
    applyTheme(theme);
    storeTheme(theme);
  },

  setHelpOpen(helpOpen) {
    set({ helpOpen });
  },
}));

editorEvents.on('project:saved', () => {
  useUiStore.setState({ savedAt: Date.now() });
});

// Slide-level commands decide which slide belongs on screen after they run,
// undo included. `core` cannot reach this store directly (05-directory's
// dependency direction), so it asks and the answer is applied here.
editorEvents.on('slide:focusRequest', ({ index }) => {
  useUiStore.getState().setSlideIndex(index);
});

editorEvents.on('error', ({ message, cause }) => {
  console.error('[editor]', message, cause);
  useUiStore.getState().notify('error', message);
});

// The machine's palette can change while the app is open — a sunset schedule,
// or the user flipping it elsewhere. Only `system` is asking to be told.
watchSystemTheme(() => {
  const { theme } = useUiStore.getState();
  if (theme === 'system') applyTheme(theme);
});
