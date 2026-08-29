import { beforeEach, describe, expect, it } from 'vitest';

import { askCloseAction, useClosePromptStore } from './closePrompt';

/**
 * The close guard awaits this promise before it decides whether to destroy the
 * window, so a question that never resolves is a window that can never be
 * closed again. Every path out of the dialog has to answer it exactly once.
 */
describe('close prompt', () => {
  beforeEach(() => {
    useClosePromptStore.setState({ answer: null });
  });

  it('resolves with the button the user pressed', async () => {
    const pending = askCloseAction();
    expect(useClosePromptStore.getState().answer).not.toBeNull();

    useClosePromptStore.getState().respond('discard');

    await expect(pending).resolves.toBe('discard');
    // The dialog closes with the answer: nothing left on screen to press twice.
    expect(useClosePromptStore.getState().answer).toBeNull();
  });

  it('answers "stay" to a question a second close request replaces', async () => {
    const first = askCloseAction();
    const second = askCloseAction();

    useClosePromptStore.getState().respond('export');

    await expect(first).resolves.toBe('cancel');
    await expect(second).resolves.toBe('export');
  });

  it('ignores an answer with no question on screen', () => {
    expect(() => useClosePromptStore.getState().respond('cancel')).not.toThrow();
  });
});
