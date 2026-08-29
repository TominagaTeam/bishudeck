/**
 * The "there is unsaved work" question asked when the window is closed.
 *
 * It is an in-app modal rather than the OS dialog (`ask()` from the dialog
 * plugin) because that one only has two buttons, and this question has three
 * answers: write and quit, quit anyway, or stay. A close hit by accident needs
 * a way back, and the only way back a close has is "never mind".
 *
 * The state lives here rather than in `uiStore` because it is one exchange with
 * one caller — the close guard in autosave.ts — and nothing else may read it.
 */

import { create } from 'zustand';

export type CloseChoice = 'export' | 'discard' | 'cancel';

interface ClosePromptState {
  /** Set while the question is on screen; resolves the pending `askCloseAction`. */
  answer: ((choice: CloseChoice) => void) | null;
  open(answer: (choice: CloseChoice) => void): void;
  respond(choice: CloseChoice): void;
}

export const useClosePromptStore = create<ClosePromptState>((set, get) => ({
  answer: null,

  open(answer) {
    // A second close request while the question is already up asks the same
    // question, so the first one is answered "stay" rather than left hanging.
    get().answer?.('cancel');
    set({ answer });
  },

  respond(choice) {
    const { answer } = get();
    if (!answer) return;
    set({ answer: null });
    answer(choice);
  },
}));

/** Puts the question on screen and waits for the button the user presses. */
export function askCloseAction(): Promise<CloseChoice> {
  return new Promise((resolve) => useClosePromptStore.getState().open(resolve));
}
