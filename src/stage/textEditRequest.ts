/**
 * A request from outside the stage to start editing an element's text.
 *
 * The context menu lives in `features` and cannot reach into the stage's
 * `contenteditable` handling, which is where every rule about entering and
 * leaving a text session already lives. Asking through a store — the way
 * `useCropSession` asks for a crop — keeps that in one place.
 */

import { create } from 'zustand';

interface TextEditRequest {
  /** The element to edit, cleared by the stage as soon as it acts on it. */
  uid: string | null;
  request(uid: string): void;
  clear(): void;
}

export const useTextEditRequest = create<TextEditRequest>((set) => ({
  uid: null,
  request(uid) {
    set({ uid });
  },
  clear() {
    set({ uid: null });
  },
}));
