/**
 * What the stage's context menu is currently pointing at.
 *
 * The stage decides *what* was right-clicked; a feature component decides what
 * to offer for it. Passing that through a store rather than a callback keeps
 * the dependency running one way — `features` may read `stage`, not the reverse.
 */

import { create } from 'zustand';

export interface StageMenuTarget {
  /** Viewport coordinates, because the menu is drawn outside the stage. */
  at: { x: number; y: number };
  /** null when the click landed on empty space. */
  uid: string | null;
  /** Whether 「トリミング」 applies, decided while the element was still to hand. */
  croppable: boolean;
  /** Whether 「画像を入れる」 applies, decided on the same terms as `croppable`. */
  fillable: boolean;
  /** Whether the element has text of its own to edit. */
  textEditable: boolean;
  /**
   * Everything under that point, front to back, labelled the way the
   * breadcrumb labels things. Decided at open time, while the point is still
   * known: the menu is drawn elsewhere and has no way to ask again.
   *
   * The whole pile rather than just the next step back (issues #102). One step
   * is the right thing for a *gesture* — Alt+click repeats, so it walks — but a
   * menu is read before it is used, and offering "the one behind" makes the
   * reader guess what that is. Here they are looking at the list.
   */
  stack: { uid: string; label: string }[];
}

interface StageContextMenuState {
  target: StageMenuTarget | null;
  open(target: StageMenuTarget): void;
  close(): void;
}

export const useStageContextMenu = create<StageContextMenuState>((set) => ({
  target: null,
  open(target) {
    set({ target });
  },
  close() {
    set({ target: null });
  },
}));
