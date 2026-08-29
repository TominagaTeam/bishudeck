import { beforeEach, describe, expect, it } from 'vitest';

import { clearHistory, redo, setActiveStage, undo } from '../commands/engine';
import { composeSlideDocument } from '../document/compose';
import { useDocumentStore } from '../document/store';
import { useSelectionStore } from '../selection/store';
import { buildProject } from '../../import/pipeline';
import { StageBridge } from '../../stage/bridge';
import {
  BLANK_ATTRIBUTE,
  CARET_LINE_ATTRIBUTE,
  openCaretLine,
  syncBlankMark,
} from '../../stage/placeholder';
import { cloneInPlace, deleteSelection, duplicateSelection } from './actions';

// jsdom ships no CSS.escape; both target WebViews have it.
if (typeof CSS === 'undefined') {
  globalThis.CSS = { escape: (value: string) => value } as never;
}

const DECK = `<!doctype html>
<html>
  <body>
    <section class="slide"><h1 class="headline">タイトル</h1><p>本文</p></section>
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

describe('deleteSelection', () => {
  beforeEach(() => {
    useSelectionStore.getState().clear();
  });

  it('brings the element back selected when undone', () => {
    const { bridge, doc } = mountStage();
    const headline = doc.querySelector('.headline')!;
    const uid = bridge.uidOf(headline)!;
    useSelectionStore.getState().select(uid);

    deleteSelection();
    expect(doc.querySelector('.headline')).toBeNull();
    expect(useSelectionStore.getState().uid).toBeNull();

    undo();
    // The restored markup carries the same uid, so the selection is meaningful:
    // the user can keep working on what they just got back.
    expect(doc.querySelector('.headline')).not.toBeNull();
    expect(useSelectionStore.getState().uid).toBe(uid);
    expect(bridge.resolve(uid)).toBe(doc.querySelector('.headline'));

    redo();
    expect(doc.querySelector('.headline')).toBeNull();
    expect(useSelectionStore.getState().uid).toBeNull();
  });

  it('drops a uid the restored markup no longer holds', () => {
    const { bridge, doc } = mountStage();
    const uid = bridge.uidOf(doc.querySelector('p')!)!;
    useSelectionStore.getState().select(uid);

    deleteSelection();
    // A uid that resolves to nothing, standing where the redo will look for the
    // selection to put back. It must be dropped rather than left on the overlay.
    useSelectionStore.getState().select('never-existed');

    undo();
    expect(useSelectionStore.getState().uid).toBe(uid);

    redo();
    expect(useSelectionStore.getState().uid).toBeNull();
  });
});

/**
 * The offset and the insertion point are what make ⌘D land somewhere visible
 * without leaving the layout it belongs to. `cloneInPlace` was pulled out of
 * here for Alt-drag; these pin that pulling it out changed nothing.
 */
describe('duplicateSelection', () => {
  beforeEach(() => {
    useSelectionStore.getState().clear();
  });

  it('inserts the copy as the next sibling, nudged clear of the original', () => {
    const { bridge, doc } = mountStage();
    const headline = doc.querySelector('.headline')!;
    useSelectionStore.getState().select(bridge.uidOf(headline)!);

    duplicateSelection();

    const copies = doc.querySelectorAll('.headline');
    expect(copies).toHaveLength(2);
    expect(headline.nextElementSibling).toBe(copies[1]);
    expect((copies[1] as HTMLElement).style.transform).toContain('translate(16px, 16px)');
  });

  it('leaves the copy selected, ready to be moved', () => {
    const { bridge, doc } = mountStage();
    useSelectionStore.getState().select(bridge.uidOf(doc.querySelector('.headline')!)!);

    duplicateSelection();

    const copy = doc.querySelectorAll('.headline')[1]!;
    expect(useSelectionStore.getState().uid).toBe(bridge.uidOf(copy));
  });

  it('undoes to exactly one element again', () => {
    const { bridge, doc } = mountStage();
    useSelectionStore.getState().select(bridge.uidOf(doc.querySelector('.headline')!)!);

    duplicateSelection();
    undo();
    expect(doc.querySelectorAll('.headline')).toHaveLength(1);
    redo();
    expect(doc.querySelectorAll('.headline')).toHaveLength(2);
  });
});

describe('cloneInPlace', () => {
  beforeEach(() => {
    useSelectionStore.getState().clear();
  });

  it('copies without an offset, so a drag decides where it lands', () => {
    const { bridge, doc } = mountStage();
    const headline = doc.querySelector('.headline') as HTMLElement;
    headline.style.transform = 'translate(40px, 10px)';

    const clone = cloneInPlace(bridge, bridge.uidOf(headline)!) as HTMLElement;

    expect(clone.style.transform).toBe('translate(40px, 10px)');
    expect(headline.nextElementSibling).toBe(clone);
  });

  it('strips the uids so the copy gets its own on the next reindex', () => {
    const { bridge, doc } = mountStage();
    const headline = doc.querySelector('.headline')!;

    const clone = cloneInPlace(bridge, bridge.uidOf(headline)!)!;
    expect(clone.hasAttribute('data-hse-uid')).toBe(false);

    bridge.reindex();
    const uid = bridge.uidOf(clone);
    expect(uid).not.toBeNull();
    expect(uid).not.toBe(bridge.uidOf(headline));
  });

  /** An element wearing everything an open text session puts on it. */
  function openSessionOn(element: HTMLElement): void {
    element.setAttribute('contenteditable', 'true');
    element.setAttribute('spellcheck', 'false');
    element.textContent = '';
    openCaretLine(element);
    syncBlankMark(element);
  }

  // A session runs on one element, and the code that ends it only ever knows
  // about that one. So a copy carrying the marks had nothing to take them off
  // again: 「テキストを入力」 stayed painted over the copy, which could not even
  // be typed into — it is not the box the stage is holding a place for.
  it('leaves the session behind rather than copying it', () => {
    const { bridge, doc } = mountStage();
    const headline = doc.querySelector('.headline') as HTMLElement;
    openSessionOn(headline);

    const clone = cloneInPlace(bridge, bridge.uidOf(headline)!) as HTMLElement;

    expect(clone.hasAttribute(BLANK_ATTRIBUTE)).toBe(false);
    expect(clone.hasAttribute('contenteditable')).toBe(false);
    expect(clone.hasAttribute('spellcheck')).toBe(false);
    expect(clone.querySelector(`[${CARET_LINE_ATTRIBUTE}]`)).toBeNull();
    // The original is still mid-session; only the copy left it behind.
    expect(headline.hasAttribute(BLANK_ATTRIBUTE)).toBe(true);
    expect(headline.getAttribute('contenteditable')).toBe('true');
  });

  it('reaches the marks on the children as well as the element itself', () => {
    const { bridge, doc } = mountStage();
    const headline = doc.querySelector('.headline') as HTMLElement;
    const inner = doc.createElement('span');
    inner.className = 'accent';
    headline.appendChild(inner);
    openSessionOn(inner);
    bridge.reindex();

    const clone = cloneInPlace(bridge, bridge.uidOf(headline)!) as HTMLElement;

    expect(clone.querySelector(`[${BLANK_ATTRIBUTE}]`)).toBeNull();
    expect(clone.querySelector('[contenteditable]')).toBeNull();
    expect(clone.querySelector('[data-hse-uid]')).toBeNull();
    // Only the editor's own marks: the child and its class are the deck's.
    expect(clone.querySelector('span.accent')).not.toBeNull();
  });
});

/**
 * The same question at the other door. Every structural edit records the slide
 * either side of itself, so anything on an element at that moment is baked into
 * the history — and undo puts markup back without any session to go with it.
 */
describe('history snapshots', () => {
  beforeEach(() => {
    useSelectionStore.getState().clear();
  });

  it('hands back an element that is no longer wearing a session', () => {
    const { bridge, doc } = mountStage();
    const headline = doc.querySelector('.headline') as HTMLElement;
    headline.setAttribute('contenteditable', 'true');
    headline.textContent = '';
    syncBlankMark(headline);
    const uid = bridge.uidOf(headline)!;
    useSelectionStore.getState().select(uid);

    deleteSelection();
    undo();

    const restored = doc.querySelector('.headline')!;
    expect(restored.hasAttribute(BLANK_ATTRIBUTE)).toBe(false);
    expect(restored.hasAttribute('contenteditable')).toBe(false);
    // …and is still the element the history was pointing at, or restoring the
    // selection along with the markup would mean nothing (invariant 6).
    expect(bridge.resolve(uid)).toBe(restored);
    expect(useSelectionStore.getState().uid).toBe(uid);
  });
});
