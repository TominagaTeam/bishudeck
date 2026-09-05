import { beforeEach, describe, expect, it } from 'vitest';

import { clearHistory, redo, setActiveStage, undo, useHistory } from '../commands/engine';
import { composeSlideDocument } from '../document/compose';
import { useDocumentStore } from '../document/store';
import { useSelectionStore } from '../selection/store';
import { buildProject } from '../../import/pipeline';
import { StageBridge } from '../../stage/bridge';
import {
  BOX_PROPERTIES,
  PAINTABLE_PROPERTIES,
  TEXT_PROPERTIES,
  clearCopiedFormat,
  copyFormat,
  hasCopiedFormat,
  pasteFormat,
} from './format';
import { INHERITED_PROPERTIES } from './listOverrides';
import { t } from '../../shared/i18n';

// jsdom ships no CSS.escape; both target WebViews have it.
if (typeof CSS === 'undefined') {
  globalThis.CSS = { escape: (value: string) => value } as never;
}

const DECK = `<!doctype html>
<html>
  <body>
    <section class="slide">
      <h1 class="source" style="color: rgb(255, 0, 0); text-align: center; left: 40px; width: 300px">見出し</h1>
      <p class="target" style="left: 500px; width: 200px">本文</p>
      <div class="listed"><ul><li>ひとつめ</li></ul></div>
    </section>
  </body>
</html>`;

/**
 * A real iframe, not `DOMParser`.
 *
 * The format painter reads *computed* style, and a parsed document is never
 * rendered — it has no `defaultView`, so there is nothing to ask. The stage
 * puts the slide in an iframe, which does have one.
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

describe('the paintable white list', () => {
  /**
   * `listOverrides.ts` spells its own set out rather than importing this one —
   * it cannot, since `format.ts` imports *it*. This is what holds the two
   * together: add an inherited property to the brush without adding it there
   * and the paste stops reaching the lines, silently and only on decks that
   * name their own lists.
   */
  it('has every inherited property it carries covered by the list spread', () => {
    for (const property of TEXT_PROPERTIES) {
      // The alignment is spread by a branch of its own, unconditionally.
      if (property === 'text-align') continue;
      expect(INHERITED_PROPERTIES).toContain(property);
    }
  });

  // The other direction: a box property pushed onto a `<li>` would paint a
  // background behind every line, because it never inherited in the first place.
  it('keeps the box half out of the spread', () => {
    for (const property of BOX_PROPERTIES) {
      expect(INHERITED_PROPERTIES).not.toContain(property);
    }
  });

  /**
   * The rule the whole feature rests on. Copying an element and re-placing it
   * by absolute numbers is what sank the earlier copy/paste; painting a format
   * only stays safe as long as it carries no geometry.
   */
  it('carries no property that could move or resize what it paints', () => {
    for (const forbidden of [
      'left',
      'top',
      'right',
      'bottom',
      'width',
      'height',
      'position',
      'transform',
      'display',
      'margin',
      'float',
    ]) {
      expect(PAINTABLE_PROPERTIES).not.toContain(forbidden);
    }
  });
});

describe('copyFormat / pasteFormat', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    useSelectionStore.getState().clear();
    clearCopiedFormat();
  });

  it('paints the look across without touching the placement', () => {
    const { bridge, doc } = mountStage();
    const target = doc.querySelector('.target') as HTMLElement;

    select(bridge, doc.querySelector('.source')!);
    expect(copyFormat()).toBe(true);

    select(bridge, target);
    expect(pasteFormat()).toBe(true);

    expect(target.style.color).toBe('rgb(255, 0, 0)');
    // Exactly what it started with: the brush never reaches these.
    expect(target.style.left).toBe('500px');
    expect(target.style.width).toBe('200px');
  });

  it('is one undo step', () => {
    const { bridge, doc } = mountStage();
    const target = doc.querySelector('.target') as HTMLElement;

    select(bridge, doc.querySelector('.source')!);
    copyFormat();
    select(bridge, target);
    pasteFormat();

    expect(useHistory.getState().undoStack).toHaveLength(1);
    expect(useHistory.getState().undoLabel).toBe(t('command.pasteFormat'));

    undo();
    expect(target.style.color).toBe('');
    redo();
    expect(target.style.color).toBe('rgb(255, 0, 0)');
  });

  it('keeps the brush loaded across selection changes', () => {
    const { bridge, doc } = mountStage();
    select(bridge, doc.querySelector('.source')!);
    copyFormat();

    useSelectionStore.getState().clear();
    expect(hasCopiedFormat()).toBe(true);
  });

  it('does nothing without a selection', () => {
    mountStage();
    expect(copyFormat()).toBe(false);
    expect(hasCopiedFormat()).toBe(false);
  });

  it('does nothing when nothing has been copied', () => {
    const { bridge, doc } = mountStage();
    select(bridge, doc.querySelector('.target')!);

    expect(pasteFormat()).toBe(false);
    expect(useHistory.getState().undoStack).toHaveLength(0);
  });

  // The brush carries `text-align`, so it meets the same wall the 行揃え button
  // does: a list between the declaration and the words.
  it('paints an alignment past the list in the way', () => {
    const { bridge, doc } = mountStage();
    const listed = doc.querySelector('.listed') as HTMLElement;

    select(bridge, doc.querySelector('.source')!);
    copyFormat();
    select(bridge, listed);
    expect(pasteFormat()).toBe(true);

    expect((doc.querySelector('.listed ul') as HTMLElement).style.textAlign).toBe('center');
    expect((doc.querySelector('.listed li') as HTMLElement).style.textAlign).toBe('center');
  });

  // The alignment was only the first declaration to be stopped. Anything the
  // brush carries that reaches a line by inheritance meets the same rule —
  // here a size the list declares for itself.
  it('paints a size past a list that declares its own', () => {
    const { bridge, doc } = mountStage();
    const listed = doc.querySelector('.listed') as HTMLElement;
    const inner = doc.querySelector('.listed ul') as HTMLElement;
    inner.style.fontSize = '26px';

    const source = doc.querySelector('.source') as HTMLElement;
    source.style.fontSize = '44px';
    select(bridge, source);
    copyFormat();
    select(bridge, listed);
    pasteFormat();

    expect(inner.style.fontSize).toBe('44px');
  });

  it('takes the whole brush stroke back in one step, list included', () => {
    const { bridge, doc } = mountStage();

    select(bridge, doc.querySelector('.source')!);
    copyFormat();
    select(bridge, doc.querySelector('.listed')!);
    pasteFormat();

    expect(useHistory.getState().undoStack).toHaveLength(1);

    undo();
    expect((doc.querySelector('.listed ul') as HTMLElement).getAttribute('style') ?? '').toBe('');
    expect((doc.querySelector('.listed') as HTMLElement).style.color).toBe('');
  });
});
