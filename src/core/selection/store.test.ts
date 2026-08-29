import { beforeEach, describe, expect, it } from 'vitest';

import { useSelectionStore } from './store';

/**
 * The breadcrumb preview is a second, weaker pointer at an element. It has to
 * stay out of the selection: everything downstream — inspector, commands,
 * history — reads `uid`, and a hover that leaked in there would edit whatever
 * the mouse happened to pass over.
 */
describe('breadcrumb focus', () => {
  beforeEach(() => {
    useSelectionStore.setState({ uid: null, ancestry: [], focusUid: null });
  });

  it('does not touch the selection', () => {
    useSelectionStore.getState().select('a');
    useSelectionStore.getState().focusOn('b');

    expect(useSelectionStore.getState().uid).toBe('a');
    expect(useSelectionStore.getState().focusUid).toBe('b');
  });

  it('drops the preview when the selection is cleared', () => {
    useSelectionStore.getState().select('a');
    useSelectionStore.getState().focusOn('b');
    useSelectionStore.getState().clear();

    expect(useSelectionStore.getState().focusUid).toBeNull();
  });

  it('is released by focusing nothing', () => {
    useSelectionStore.getState().focusOn('b');
    useSelectionStore.getState().focusOn(null);

    expect(useSelectionStore.getState().focusUid).toBeNull();
  });
});
