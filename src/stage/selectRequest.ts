/**
 * A request from outside the stage to select an element.
 *
 * `useSelectionStore.select` is not the same thing: it moves the selection but
 * leaves the breadcrumb where it was, which is right for the breadcrumb's own
 * buttons (climbing keeps the chain you climbed) and wrong for everyone else.
 * The stage owns the pair — selection and ancestry are set together in
 * `selectElement` — so the way to ask for both is to ask the stage, exactly as
 * the context menu already asks it to open a text session
 * (stage/textEditRequest.ts).
 */

import { create } from 'zustand';

interface SelectRequest {
  /** The element to select, cleared by the stage as soon as it acts on it. */
  uid: string | null;
  request(uid: string): void;
  clear(): void;
}

export const useSelectRequest = create<SelectRequest>((set) => ({
  uid: null,
  request(uid) {
    set({ uid });
  },
  clear() {
    set({ uid: null });
  },
}));
