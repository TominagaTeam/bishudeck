import { beforeEach, describe, expect, it } from 'vitest';

import { clearHistory, setActiveStage, undo } from '../commands/engine';
import { composeSlideDocument } from '../document/compose';
import { useDocumentStore } from '../document/store';
import { useSelectionStore } from '../selection/store';
import { buildProject } from '../../import/pipeline';
import { StageBridge } from '../../stage/bridge';
import { fillWithImage, isFillable } from './imageFill';

// jsdom ships no CSS.escape; both target WebViews have it.
if (typeof CSS === 'undefined') {
  globalThis.CSS = { escape: (value: string) => value } as never;
}

/**
 * The shape import leaves an `<image-slot>` in, cut down to what matters here:
 * a box with a caption inside it and no picture (import/artifact.ts).
 */
const DECK = `<!doctype html>
<html>
  <body>
    <section class="slide">
      <h1 class="headline">タイトル</h1>
      <div class="frame" style="position:relative"><div class="caption">写真添付エリア：ターミナルの画面</div></div>
      <img class="photo" src="assets/before.png" alt="">
      <svg class="mark" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"></circle></svg>
    </section>
  </body>
</html>`;

/** Wires a real stage to the real stores, the way EditStage does on load. */
function mountStage() {
  const project = buildProject(DECK, 'generic');
  useDocumentStore.getState().loadProject(project, null);
  clearHistory();

  const html = composeSlideDocument(project.shared, project.slides[0], { mode: 'edit' });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const bridge = new StageBridge(doc, () => {
    useDocumentStore.getState().setSlideHtml(project.slides[0].id, bridge.serializeSlide());
  });
  setActiveStage(bridge);
  return { bridge, doc };
}

function select(bridge: StageBridge, element: Element): string {
  const uid = bridge.uidOf(element)!;
  useSelectionStore.getState().select(uid);
  return uid;
}

describe('isFillable', () => {
  beforeEach(() => {
    useSelectionStore.getState().clear();
  });

  it('accepts a box that holds no words of its own', () => {
    const { doc } = mountStage();
    expect(isFillable(doc.querySelector('.frame')!)).toBe(true);
  });

  it('refuses what a text session would open on', () => {
    const { doc } = mountStage();
    // The caption is the half of a photo frame a click in the middle lands on,
    // and filling it would throw away the author's description.
    expect(isFillable(doc.querySelector('.caption')!)).toBe(false);
    expect(isFillable(doc.querySelector('.headline')!)).toBe(false);
  });

  it('refuses a picture, which is トリミング territory', () => {
    const { doc } = mountStage();
    expect(isFillable(doc.querySelector('.photo')!)).toBe(false);
  });

  it('refuses an element that cannot hold children', () => {
    const { doc } = mountStage();
    expect(isFillable(doc.querySelector('.mark')!)).toBe(false);
  });
});

describe('fillWithImage', () => {
  beforeEach(() => {
    useSelectionStore.getState().clear();
  });

  it('puts the picture inside the box and keeps the box', () => {
    const { bridge, doc } = mountStage();
    const frame = doc.querySelector('.frame')!;
    const uid = select(bridge, frame);

    fillWithImage('assets/shot.png');

    // The box is still the same element at the same address: the layout around
    // it (a flex cell, a fixed aspect ratio) is what decided its size.
    expect(bridge.resolve(uid)).toBe(frame);
    const picture = frame.querySelector('img')!;
    expect(picture.getAttribute('src')).toBe('assets/shot.png');
    expect(picture.getAttribute('style')).toContain('object-fit:cover');
    expect(frame.querySelector('.caption')).toBeNull();
  });

  it('carries the caption over as the alt text', () => {
    const { bridge, doc } = mountStage();
    const frame = doc.querySelector('.frame')!;
    select(bridge, frame);

    fillWithImage('assets/shot.png');

    expect(frame.querySelector('img')!.getAttribute('alt')).toBe(
      '写真添付エリア：ターミナルの画面',
    );
  });

  it('undoes as one step, caption and all', () => {
    const { bridge, doc } = mountStage();
    const frame = doc.querySelector('.frame')!;
    select(bridge, frame);

    fillWithImage('assets/shot.png');
    undo();

    const restored = doc.querySelector('.frame')!;
    expect(restored.querySelector('img')).toBeNull();
    expect(restored.querySelector('.caption')!.textContent).toBe(
      '写真添付エリア：ターミナルの画面',
    );
  });

  it('does nothing when the selection cannot take a picture', () => {
    const { bridge, doc } = mountStage();
    const headline = doc.querySelector('.headline')!;
    select(bridge, headline);

    expect(fillWithImage('assets/shot.png')).toBeNull();
    expect(headline.textContent).toBe('タイトル');
  });

  it('leaves nothing of the editor in the saved markup', () => {
    const { bridge, doc } = mountStage();
    select(bridge, doc.querySelector('.frame')!);

    fillWithImage('assets/shot.png');

    const saved = bridge.serializeSlide();
    expect(saved).toContain('<img src="assets/shot.png"');
    expect(saved).not.toContain('data-hse-');
  });
});
