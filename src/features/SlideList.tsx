import { useEffect, useMemo, useRef, useState } from 'react';

import { execute } from '../core/commands/engine';
import { MoveSlideCommand } from '../core/commands/slide';
import { composeSlideDocument } from '../core/document/compose';
import type { SharedResources, Slide } from '../core/document/model';
import { useDocumentStore } from '../core/document/store';
import { useUiStore } from '../app/uiStore';
import { matchesShortcut } from '../shared/shortcuts';
import { t } from '../shared/i18n';

/** Ignore the very first measurement, before layout has settled. */
const MIN_USABLE_WIDTH = 24;

export function SlideList() {
  const slides = useDocumentStore((s) => s.project.slides);
  const shared = useDocumentStore((s) => s.project.shared);
  const slideIndex = useUiStore((s) => s.slideIndex);
  const setSlideIndex = useUiStore((s) => s.setSlideIndex);
  const step = useUiStore((s) => s.step);
  const listRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const dragFrom = useRef<number | null>(null);

  /**
   * Keyboard focus follows the selection — but only while it is already in the
   * list. Paging the deck from the stage with ← → must not pull focus out of
   * what the user is working on and into the sidebar.
   */
  useEffect(() => {
    const list = listRef.current;
    const item = itemRefs.current[slideIndex];
    if (!list || !item || !list.contains(document.activeElement)) return;
    // Scrolls the thumbnail into view as a side effect, which is what makes
    // holding ↓ through a long deck usable.
    item.focus();
  }, [slideIndex]);

  /**
   * ↑ / ↓ page the deck while the list has focus.
   *
   * The event is stopped rather than left to bubble: the same arrows nudge the
   * selected element (`arrange.nudge`), and the window handler would otherwise
   * move an object on the stage while the user is picking a slide over here.
   * Inside the list the keys mean one thing regardless of what is selected.
   */
  const onKeyDown = (event: React.KeyboardEvent) => {
    const delta = matchesShortcut('view.nextSlide', event.nativeEvent)
      ? 1
      : matchesShortcut('view.prevSlide', event.nativeEvent)
        ? -1
        : 0;
    if (delta === 0) return;
    event.preventDefault();
    event.stopPropagation();
    step(delta, slides.length);
  };

  return (
    <aside
      className="slide-list"
      ref={listRef}
      // The empty state is a paragraph, not options, so the role only holds
      // while there is something to choose from.
      role={slides.length > 0 ? 'listbox' : undefined}
      aria-label={t('slideList.label')}
      onKeyDown={onKeyDown}
    >
      {slides.length === 0 && <p className="slide-list-empty">
          {t('slideList.empty')}
          <br />
          {t('slideList.emptyHint')}
        </p>}
      {slides.map((slide, index) => (
        <div
          key={slide.id}
          ref={(element) => {
            itemRefs.current[index] = element;
          }}
          className={index === slideIndex ? 'slide-item selected' : 'slide-item'}
          role="option"
          aria-selected={index === slideIndex}
          // Roving tabindex: one Tab reaches the list at the slide it is
          // already showing, and the arrows do the moving from there.
          tabIndex={index === slideIndex ? 0 : -1}
          onClick={() => setSlideIndex(index)}
          draggable
          onDragStart={() => {
            dragFrom.current = index;
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => {
            const from = dragFrom.current;
            dragFrom.current = null;
            if (from === null || from === index) return;
            // Which slide to show afterwards is the command's answer, so that
            // an undo gets the same treatment (see core/commands/slide.ts).
            execute(new MoveSlideCommand(from, index));
          }}
        >
          <span className="slide-number">{index + 1}</span>
          <SlideThumbnail shared={shared} slide={slide} />
        </div>
      ))}
    </aside>
  );
}

/**
 * Thumbnails render the real document with scripts disabled, so they match what
 * the edit stage shows. Only the ones on screen are mounted: a deck of fifty
 * slides would otherwise mean fifty live frames.
 */
function SlideThumbnail({ shared, slide }: { shared: SharedResources; slide: Slide }) {
  const holderRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);

  // The thumbnail fills whatever the list leaves it rather than assuming a
  // width, so the selection outline always encloses it.
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;

    const intersection = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: '200px' },
    );
    intersection.observe(holder);

    const resize = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    resize.observe(holder);

    return () => {
      intersection.disconnect();
      resize.disconnect();
    };
  }, []);

  const scale = width / shared.designWidth;
  const ready = visible && width >= MIN_USABLE_WIDTH;

  const srcDoc = useMemo(
    () => (ready ? composeSlideDocument(shared, slide, { mode: 'edit' }) : ''),
    [ready, shared, slide],
  );

  return (
    <div
      className="thumb"
      ref={holderRef}
      style={{ aspectRatio: `${shared.designWidth} / ${shared.designHeight}` }}
    >
      {ready && (
        <iframe
          className="thumb-frame"
          title=""
          aria-hidden
          srcDoc={srcDoc}
          sandbox="allow-same-origin"
          style={{
            width: shared.designWidth,
            height: shared.designHeight,
            transform: `scale(${scale})`,
          }}
        />
      )}
    </div>
  );
}
