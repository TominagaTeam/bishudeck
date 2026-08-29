import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AutosaveScheduler } from './autosave';

describe('AutosaveScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('writes once after a burst of changes settles', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const scheduler = new AutosaveScheduler(1000, save);

    for (let i = 0; i < 5; i++) {
      scheduler.schedule();
      await vi.advanceTimersByTimeAsync(200);
    }
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('never lets two writes overlap, and covers what changed during one', async () => {
    let release: () => void = () => {};
    const save = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)))
      .mockResolvedValue(undefined);
    const scheduler = new AutosaveScheduler(1000, save);

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);

    // Edits land while the first write is still in flight.
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('flushes immediately without waiting out the delay', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const scheduler = new AutosaveScheduler(1000, save);

    scheduler.schedule();
    await scheduler.flush();

    expect(save).toHaveBeenCalledTimes(1);
    // The pending timer must not fire a second write afterwards.
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('keeps running after a failed write', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValue(undefined);
    const scheduler = new AutosaveScheduler(1000, save);

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('does nothing once cancelled', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const scheduler = new AutosaveScheduler(1000, save);

    scheduler.schedule();
    scheduler.cancel();
    await vi.advanceTimersByTimeAsync(5000);

    expect(save).not.toHaveBeenCalled();
  });
});
