import { useCallback, useEffect, useState } from 'react';

import { emptyProject, type Project } from '../core/document/model';
import { PreviewStage } from '../stage/PreviewStage';
import { useFitScale } from '../stage/useFitScale';
import { backend } from '../shared/backend';
import { matchesShortcut } from '../shared/shortcuts';

/**
 * The presentation window.
 *
 * It runs in its own webview with its own JavaScript context, so it pulls the
 * deck from the backend rather than sharing the editor's stores. Slides render
 * through the same preview stage the editor uses, which means what is projected
 * is the same document the author was checking.
 *
 * The window outlives a single presentation: ending one hides it and stops the
 * stage, and the next one arrives as an event rather than a fresh page load
 * (see `commands/window.rs` for why the window is never closed).
 */
export function Present({ startIndex }: { startIndex: number }) {
  const [project, setProject] = useState<Project>(() => emptyProject());
  const [index, setIndex] = useState(startIndex);
  const [running, setRunning] = useState(true);

  const { containerRef, scale } = useFitScale(
    project.shared.designWidth,
    project.shared.designHeight,
    null,
  );

  /**
   * Takes the keyboard, at both levels it can be lost at.
   *
   * Natively, going fullscreen moves the first responder off the webview, so
   * the backend has to be asked to move it back (`commands/window.rs`).
   * In the document, focus belongs on the container: the slide is a
   * cross-origin frame, and anything focused inside it swallows every key
   * before this window's listener runs.
   */
  const claimKeyboard = useCallback(() => {
    containerRef.current?.focus({ preventScroll: true });
    void backend.focusPresentationWebview();
  }, [containerRef]);

  /** Pulls whatever the editor is holding right now and starts from `from`. */
  const start = useCallback(
    async (from: number) => {
      try {
        const loaded = await backend.getLiveProject();
        if (loaded) setProject(loaded);
        setIndex(from);
        setRunning(true);
      } catch (cause) {
        console.error('[present] failed to load deck', cause);
      }
      claimKeyboard();
    },
    [claimKeyboard],
  );

  useEffect(() => {
    void start(startIndex);
  }, [start, startIndex]);

  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    void backend.onPresentStart((from) => void start(from)).then((teardown) => {
      if (cancelled) teardown();
      else stop = teardown;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [start]);

  // The window can also become key without a presentation starting — the user
  // cmd-tabs back to it — and it comes back with whatever focus it had.
  useEffect(() => {
    window.addEventListener('focus', claimKeyboard);
    return () => window.removeEventListener('focus', claimKeyboard);
  }, [claimKeyboard]);

  /**
   * Ends the presentation. The stage goes first: a hidden window that keeps
   * running the deck's animations is both wasteful and, on the day the window
   * really is torn down (quitting the app), the traffic that used to crash it.
   * The hide is therefore asked for from an effect, once React has actually
   * taken the stage out of the DOM, rather than alongside the state change.
   */
  const end = useCallback(() => setRunning(false), []);

  useEffect(() => {
    if (running) return;
    void backend.closePresentationWindow();
  }, [running]);

  const step = useCallback(
    (delta: number) => {
      const last = Math.max(project.slides.length - 1, 0);
      setIndex((i) => Math.min(Math.max(i + delta, 0), last));
    },
    [project.slides.length],
  );

  /** Click steps the deck, and takes the keyboard back on the way through. */
  const handleStep = useCallback(
    (delta: number) => {
      claimKeyboard();
      step(delta);
    },
    [claimKeyboard, step],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const last = Math.max(project.slides.length - 1, 0);
      if (matchesShortcut('present.next', event)) {
        event.preventDefault();
        step(1);
      } else if (matchesShortcut('present.prev', event)) {
        event.preventDefault();
        step(-1);
      } else if (matchesShortcut('present.first', event)) {
        setIndex(0);
      } else if (matchesShortcut('present.last', event)) {
        setIndex(last);
      } else if (matchesShortcut('present.end', event)) {
        end();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [project.slides.length, step, end]);

  return (
    <div className="present" ref={containerRef} tabIndex={-1}>
      {running && (
        <>
          <PreviewStage
            shared={project.shared}
            slide={project.slides[index] ?? null}
            slideIndex={index}
            slideCount={project.slides.length}
            designWidth={project.shared.designWidth}
            designHeight={project.shared.designHeight}
            scale={scale}
            onStep={handleStep}
          />
          <div className="present-progress">
            {project.slides.length > 0 ? `${index + 1} / ${project.slides.length}` : ''}
          </div>
        </>
      )}
    </div>
  );
}
