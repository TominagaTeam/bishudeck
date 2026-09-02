import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { INSPECTOR_PANELS_KEY, PANES, flushPreferences, useUiStore } from './uiStore';

/**
 * Pane geometry is written to `localStorage`, and the drag that produces it
 * fires on every pixel of pointer movement. These pin the debounce: the store
 * must stay in step with the pointer while the disk sees one write.
 */
describe('pane persistence', () => {
  let setItem: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    setItem = vi.spyOn(Storage.prototype, 'setItem');
  });

  afterEach(() => {
    flushPreferences();
    vi.useRealTimers();
    setItem.mockRestore();
  });

  it('writes once for a drag that moved twenty times', () => {
    const { setPaneWidth } = useUiStore.getState();
    for (let i = 0; i < 20; i += 1) setPaneWidth('slideList', 200 + i);

    // The pane itself must already be where the pointer left it.
    expect(useUiStore.getState().panes.slideList.width).toBe(219);
    expect(setItem).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledWith(
      PANES.slideList.storageKey,
      JSON.stringify({ width: 219, collapsed: false }),
    );
  });

  it('keeps the two panes independent', () => {
    useUiStore.getState().setPaneWidth('slideList', 300);
    useUiStore.getState().setPaneWidth('inspector', 400);

    vi.runAllTimers();
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(useUiStore.getState().panes.inspector.width).toBe(400);
  });

  it('flushes a pending width when the window goes away', () => {
    useUiStore.getState().setPaneWidth('slideList', 260);
    expect(setItem).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('pagehide'));
    expect(setItem).toHaveBeenCalledTimes(1);

    // Nothing is left behind for the timer to write a second time.
    vi.runAllTimers();
    expect(setItem).toHaveBeenCalledTimes(1);
  });
});

/**
 * The inspector's folds share the pane queue, so they inherit its debounce and
 * its `pagehide` flush. What they must not inherit is "record everything":
 * only the panels the user actually worked are stored, because a full map would
 * retire the per-kind layout table after a single click.
 */
describe('inspector fold persistence', () => {
  let setItem: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    useUiStore.setState({ inspectorPanels: {} });
    setItem = vi.spyOn(Storage.prototype, 'setItem');
  });

  afterEach(() => {
    flushPreferences();
    vi.useRealTimers();
    setItem.mockRestore();
  });

  it('stores only the panels that were touched', () => {
    useUiStore.getState().setInspectorPanel('border', true);

    vi.runAllTimers();
    expect(setItem).toHaveBeenCalledWith(INSPECTOR_PANELS_KEY, JSON.stringify({ border: true }));
    expect(useUiStore.getState().inspectorPanels).toEqual({ border: true });
  });

  it('writes once for a run of folds', () => {
    const { setInspectorPanel } = useUiStore.getState();
    setInspectorPanel('border', true);
    setInspectorPanel('box', false);
    setInspectorPanel('geometry', false);
    expect(setItem).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  /** Re-clicking a fold that is already where it is asked to be is not a
   *  preference change, and must not put a write on the queue. */
  it('ignores a fold that changes nothing', () => {
    useUiStore.getState().setInspectorPanel('border', true);
    vi.runAllTimers();
    setItem.mockClear();

    useUiStore.getState().setInspectorPanel('border', true);
    vi.runAllTimers();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('flushes a pending fold when the window goes away', () => {
    useUiStore.getState().setInspectorPanel('box', false);
    expect(setItem).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('pagehide'));
    expect(setItem).toHaveBeenCalledTimes(1);
  });
});

/**
 * The stored keys are panel ids, so a build that renames or retires one would
 * otherwise keep resurrecting a fold for a panel that no longer exists. An
 * empty map is always a valid answer — every panel then follows its default.
 */
describe('inspector folds restored from disk', () => {
  afterEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('keeps the booleans and drops everything else', async () => {
    localStorage.setItem(
      INSPECTOR_PANELS_KEY,
      JSON.stringify({ border: true, box: 'yes', geometry: null }),
    );
    vi.resetModules();

    const fresh = await import('./uiStore');
    expect(fresh.useUiStore.getState().inspectorPanels).toEqual({ border: true });
  });

  it('starts from the defaults when the stored value is broken', async () => {
    localStorage.setItem(INSPECTOR_PANELS_KEY, '{ not json');
    vi.resetModules();

    const fresh = await import('./uiStore');
    expect(fresh.useUiStore.getState().inspectorPanels).toEqual({});
  });
});

/**
 * Paging the deck arrives from three places — the stage's ← →, the slide list's
 * ↑ ↓, and Home / End — and they all come through `step`. The clamp lives here
 * so those three cannot disagree about what happens at the ends.
 */
describe('paging the deck', () => {
  beforeEach(() => {
    useUiStore.getState().setSlideIndex(0);
  });

  it('stops at both ends rather than wrapping', () => {
    const { step } = useUiStore.getState();

    step(-1, 3);
    expect(useUiStore.getState().slideIndex).toBe(0);

    step(1, 3);
    step(1, 3);
    expect(useUiStore.getState().slideIndex).toBe(2);

    step(1, 3);
    expect(useUiStore.getState().slideIndex).toBe(2);
  });

  it('does nothing to an empty deck', () => {
    useUiStore.getState().step(1, 0);
    expect(useUiStore.getState().slideIndex).toBe(0);
  });
});
