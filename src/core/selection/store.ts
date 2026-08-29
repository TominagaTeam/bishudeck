import { create } from 'zustand';

import { editorEvents } from '../events/bus';

interface SelectionState {
  /**
   * The selected element, or nothing.
   *
   * Exactly one element at a time: multi-selection was removed because every
   * downstream panel — inspector, geometry, text format — only ever acted on
   * the first uid, so selecting a second element looked like it did something
   * and then refused every edit.
   */
  uid: string | null;
  /** Ancestor chain of the selection, outermost first, for the breadcrumb. */
  ancestry: { uid: string; label: string }[];
  /**
   * The element a breadcrumb crumb is pointing at, outlined on the stage.
   *
   * Kept apart from `uid` because it is a preview, not a selection: nothing
   * downstream (inspector, commands, history) may act on it.
   */
  focusUid: string | null;

  select(uid: string | null): void;
  clear(): void;
  setAncestry(ancestry: { uid: string; label: string }[]): void;
  focusOn(uid: string | null): void;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  uid: null,
  ancestry: [],
  focusUid: null,

  select(uid) {
    if (get().uid === uid) return;
    set({ uid });
    editorEvents.emit('selection:changed', { uid });
  },

  clear() {
    if (get().uid === null) return;
    set({ uid: null, ancestry: [], focusUid: null });
    editorEvents.emit('selection:changed', { uid: null });
  },

  setAncestry(ancestry) {
    set({ ancestry });
  },

  focusOn(uid) {
    if (get().focusUid === uid) return;
    set({ focusUid: uid });
  },
}));
