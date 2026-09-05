import { beforeEach, describe, expect, it } from 'vitest';

import { clearHistory, redo, setActiveStage, undo, useHistory } from '../commands/engine';
import { composeSlideDocument } from '../document/compose';
import { useDocumentStore } from '../document/store';
import { useSelectionStore } from '../selection/store';
import { buildProject } from '../../import/pipeline';
import { StageBridge } from '../../stage/bridge';
import { UID_ATTRIBUTE } from '../../shared/ids';
import { BLANK_ATTRIBUTE } from '../../stage/placeholder';
import { t } from '../../shared/i18n';
import {
  clearClipboard,
  copySelection,
  cutSelection,
  hasClipboardElement,
  pasteClipboard,
} from './clipboard';

// jsdom ships no CSS.escape; both target WebViews have it.
if (typeof CSS === 'undefined') {
  globalThis.CSS = { escape: (value: string) => value } as never;
}

/**
 * Two cards inside a wrapper, and a headline outside it.
 *
 * The wrapper is one point: it stands for the grid cell / `.container .card`
 * that the first attempt at this feature used to pull elements out of. The
 * other is that the two are laid out differently — the cards are placed by
 * their parent, the headline places itself — which is what decides whether a
 * paste is nudged clear of the original.
 */
const DECK = `<!doctype html>
<html>
  <body>
    <section class="slide">
      <div class="grid">
        <div class="card" id="a">ひとつめ</div>
        <div class="card" id="b">ふたつめ</div>
      </div>
      <h1 class="headline" style="position: absolute; left: 40px; top: 40px">タイトル</h1>
    </section>
  </body>
</html>`;

/**
 * Wires a real stage to the real stores, the way EditStage does on load.
 *
 * A real iframe rather than `DOMParser`, as the format painter's tests do: a
 * copy asks how the element is positioned, and a parsed document has no
 * `defaultView` to answer with. The stage puts the slide in an iframe, which
 * does have one.
 */
function mountStage() {
  const project = buildProject(DECK, 'generic');
  useDocumentStore.getState().loadProject(project, null);
  clearHistory();

  const html = composeSlideDocument(project.shared, project.slides[0], { mode: 'edit' });
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();

  const bridge = new StageBridge(doc, () => {
    useDocumentStore.getState().setSlideHtml(project.slides[0].id, bridge.serializeSlide());
  });
  setActiveStage(bridge);
  return { bridge, doc };
}

function select(bridge: StageBridge, element: Element): void {
  useSelectionStore.getState().select(bridge.uidOf(element)!);
}

beforeEach(() => {
  useSelectionStore.getState().clear();
  clearClipboard();
});

describe('copySelection', () => {
  it('takes nothing on a slide root, which cannot be pasted into itself', () => {
    const { bridge, doc } = mountStage();
    select(bridge, doc.querySelector('.slide')!);

    expect(copySelection()).toBe(false);
    expect(hasClipboardElement()).toBe(false);
  });

  it('leaves the history alone — nothing about the document changed', () => {
    const { bridge, doc } = mountStage();
    select(bridge, doc.querySelector('#a')!);

    copySelection();
    expect(useHistory.getState().canUndo).toBe(false);
  });
});

/**
 * Where a paste lands is the whole of what sank this feature the first time:
 * an element dropped under the slide root loses the parent whose CSS was
 * painting it. These pin the rule that replaced it.
 */
describe('pasteClipboard', () => {
  it('puts the copy beside the selection, inside the same parent', () => {
    const { bridge, doc } = mountStage();
    select(bridge, doc.querySelector('#a')!);
    copySelection();

    select(bridge, doc.querySelector('#b')!);
    pasteClipboard();

    const cards = doc.querySelectorAll('.grid > .card');
    expect(cards).toHaveLength(3);
    // Third child of the grid, not a fourth child of the slide.
    expect(cards[2]!.textContent).toBe('ひとつめ');
    expect(doc.querySelector('#b')!.nextElementSibling).toBe(cards[2]);
  });

  /**
   * A card is placed by the grid, so the copy is given a cell of its own and
   * cannot hide behind the original. Nudging it there is not "clear of the
   * original" but "16px out of its own cell", which is what a real browser
   * showed before this was conditioned on how the element is positioned.
   */
  it('leaves an element its parent lays out exactly where the parent puts it', () => {
    const { bridge, doc } = mountStage();
    select(bridge, doc.querySelector('#a')!);
    copySelection();
    select(bridge, doc.querySelector('#b')!);
    pasteClipboard();

    const copy = doc.querySelectorAll('.card')[2]! as HTMLElement;
    expect(copy.style.transform).toBe('');
  });

  it('falls back to the slide root when there is nothing to sit beside', () => {
    const { bridge, doc } = mountStage();
    select(bridge, doc.querySelector('#a')!);
    copySelection();

    useSelectionStore.getState().clear();
    pasteClipboard();

    const slide = doc.querySelector('.slide')!;
    expect(slide.lastElementChild!.textContent).toBe('ひとつめ');
    expect(doc.querySelectorAll('.grid > .card')).toHaveLength(2);
  });

  it('leaves what it pasted selected, ready to be moved', () => {
    const { bridge, doc } = mountStage();
    select(bridge, doc.querySelector('.headline')!);
    copySelection();
    pasteClipboard();

    const copy = doc.querySelectorAll('.headline')[1]!;
    expect(useSelectionStore.getState().uid).toBe(bridge.uidOf(copy));
  });

  it('gives the copy an address of its own', () => {
    const { bridge, doc } = mountStage();
    const source = doc.querySelector('.headline')!;
    const sourceUid = bridge.uidOf(source)!;
    select(bridge, source);
    copySelection();
    pasteClipboard();

    const copy = doc.querySelectorAll('.headline')[1]!;
    expect(bridge.uidOf(copy)).not.toBe(sourceUid);
    // The original still answers to its own address rather than to the copy.
    expect(bridge.resolve(sourceUid)).toBe(source);
  });

  it('does not carry the editor’s own marks onto the copy', () => {
    const { bridge, doc } = mountStage();
    const source = doc.querySelector('.headline')! as HTMLElement;
    source.setAttribute(BLANK_ATTRIBUTE, '');
    source.setAttribute('contenteditable', 'true');
    select(bridge, source);
    copySelection();
    // Off the original too, so only what the paste brought with it is left.
    source.removeAttribute(BLANK_ATTRIBUTE);
    source.removeAttribute('contenteditable');

    pasteClipboard();
    const copy = doc.querySelectorAll('.headline')[1]!;
    expect(copy.hasAttribute(BLANK_ATTRIBUTE)).toBe(false);
    expect(copy.hasAttribute('contenteditable')).toBe(false);
    expect(copy.getAttribute(UID_ATTRIBUTE)).not.toBe('');
  });

  it('steps each self-positioned paste further out while the last is still there', () => {
    const { bridge, doc } = mountStage();
    select(bridge, doc.querySelector('.headline')!);
    copySelection();

    pasteClipboard();
    pasteClipboard();
    pasteClipboard();

    const copies = Array.from(doc.querySelectorAll('.headline')) as HTMLElement[];
    expect(copies).toHaveLength(4);
    expect(copies[1]!.style.transform).toContain('translate(16px, 16px)');
    expect(copies[2]!.style.transform).toContain('translate(32px, 32px)');
    expect(copies[3]!.style.transform).toContain('translate(48px, 48px)');
  });

  it('undoes to exactly what was there before', () => {
    const { bridge, doc } = mountStage();
    select(bridge, doc.querySelector('#a')!);
    copySelection();
    select(bridge, doc.querySelector('#b')!);

    pasteClipboard();
    expect(doc.querySelectorAll('.card')).toHaveLength(3);

    undo();
    expect(doc.querySelectorAll('.card')).toHaveLength(2);
    redo();
    expect(doc.querySelectorAll('.card')).toHaveLength(3);
  });

  it('does nothing when nothing has been copied', () => {
    mountStage();
    expect(pasteClipboard()).toBe(false);
    expect(useHistory.getState().canUndo).toBe(false);
  });
});

describe('cutSelection', () => {
  it('removes the element and names the step for what was asked', () => {
    const { bridge, doc } = mountStage();
    select(bridge, doc.querySelector('#a')!);

    expect(cutSelection()).toBe(true);
    expect(doc.querySelector('#a')).toBeNull();
    expect(useHistory.getState().undoLabel).toBe(t('command.cut'));
  });

  /**
   * Nothing is left behind for the copy to hide under, so a cut and paste puts
   * the element back where it was rather than 16px away from where it was.
   */
  it('pastes back to the position it was taken from', () => {
    const { bridge, doc } = mountStage();
    const headline = doc.querySelector('.headline')! as HTMLElement;
    // Self-positioned, so this is the case that *would* be nudged if the
    // original were still there.
    headline.style.transform = 'translate(100px, 50px)';
    select(bridge, headline);

    cutSelection();
    pasteClipboard();

    const back = doc.querySelector('.headline')! as HTMLElement;
    expect(back.style.transform).toContain('translate(100px, 50px)');
  });

  it('takes nothing when there is no selection', () => {
    mountStage();
    expect(cutSelection()).toBe(false);
    expect(hasClipboardElement()).toBe(false);
  });
});
