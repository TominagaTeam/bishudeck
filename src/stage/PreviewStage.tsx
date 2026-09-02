import { useEffect, useRef, useState } from 'react';

import { editorEvents } from '../core/events/bus';
import { composeSlideDocument } from '../core/document/compose';
import type { SharedResources, Slide } from '../core/document/model';
import { backend } from '../shared/backend';
import { StageSurface } from './StageSurface';
import { t } from '../shared/i18n';

interface PreviewStageProps {
  shared: SharedResources;
  slide: Slide | null;
  /** Position of `slide` in the deck, for scripts that key off the index. */
  slideIndex: number;
  slideCount: number;
  designWidth: number;
  designHeight: number;
  scale: number;
  /**
   * Presentation only: covers the slide so pointer events never reach it, and
   * turns a click into a step through the deck.
   *
   * The frame is a cross-origin document (`slides://`, no `allow-same-origin`),
   * so a click that lands inside it moves focus there and the host stops seeing
   * key events entirely — the same failure the edit stage's interaction layer
   * exists to prevent, and the reason Escape and the arrow keys would go quiet
   * for the rest of the presentation. The editor's preview pane passes nothing
   * and keeps the deck clickable.
   */
  onStep?: (delta: number) => void;
}

/**
 * Renders a slide with its scripts running, exactly as authored.
 *
 * The document is served from the `slides://` origin and the frame is sandboxed
 * with `allow-scripts` but deliberately *not* `allow-same-origin`: the deck's
 * JavaScript gets a normal browser environment, yet cannot reach this window or
 * the Tauri IPC bridge.
 *
 * Two frames alternate so a slide change swaps to an already-loaded document
 * instead of flashing an empty frame mid-presentation.
 */
export function PreviewStage({
  shared,
  slide,
  slideIndex,
  slideCount,
  designWidth,
  designHeight,
  scale,
  onStep,
}: PreviewStageProps) {
  const [urls, setUrls] = useState<[string | null, string | null]>([null, null]);
  const [active, setActive] = useState(0);
  const [baseUrl, setBaseUrl] = useState<string | null>(null);

  const activeRef = useRef(0);
  const tokenRef = useRef(0);
  const pendingRef = useRef<{ buffer: number; token: number } | null>(null);

  useEffect(() => {
    backend
      .previewBaseUrl()
      .then(setBaseUrl)
      .catch((cause) => editorEvents.emit('error', { message: t('error.previewInitFailed'), cause }));
  }, []);

  useEffect(() => {
    if (!slide || baseUrl === null) return;

    const token = (tokenRef.current += 1);
    const target = 1 - activeRef.current;

    const html = composeSlideDocument(shared, slide, {
      mode: 'preview',
      baseUrl,
      deckPosition: { index: slideIndex, total: slideCount },
    });
    // A fresh id per publish gives a fresh URL, which is what makes the frame
    // reload rather than reuse a cached document.
    backend
      .publishPreview(`${slide.id}-${token}`, html)
      .then((url) => {
        if (tokenRef.current !== token) return;
        pendingRef.current = { buffer: target, token };
        setUrls((previous) => {
          const next: [string | null, string | null] = [...previous];
          next[target] = url;
          return next;
        });
      })
      .catch((cause) => editorEvents.emit('error', { message: t('error.slideRenderFailed'), cause }));
  }, [shared, slide, slideIndex, slideCount, baseUrl]);

  const handleLoad = (buffer: number) => {
    const pending = pendingRef.current;
    if (!pending || pending.buffer !== buffer || pending.token !== tokenRef.current) return;
    pendingRef.current = null;
    activeRef.current = buffer;
    setActive(buffer);
    if (slide) editorEvents.emit('stage:ready', { slideId: slide.id });
  };

  if (!slide) return <div className="stage-empty">{t('stage.empty')}</div>;

  return (
    <StageSurface designWidth={designWidth} designHeight={designHeight} scale={scale}>
      {[0, 1].map((buffer) => (
        <iframe
          key={buffer}
          className="stage-frame"
          title={buffer === active ? t('stage.previewTitle') : t('stage.loadingTitle')}
          src={urls[buffer] ?? 'about:blank'}
          sandbox="allow-scripts"
          style={{ opacity: buffer === active ? 1 : 0, zIndex: buffer === active ? 1 : 0 }}
          onLoad={() => handleLoad(buffer)}
        />
      ))}
      {onStep && (
        <div
          className="stage-shield"
          // Which half was hit decides the direction, the way clicking a deck
          // does in PowerPoint — and in `<deck-stage>`, this deck's own runtime.
          onPointerDown={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            onStep(event.clientX < bounds.left + bounds.width / 2 ? -1 : 1);
          }}
        />
      )}
    </StageSurface>
  );
}
