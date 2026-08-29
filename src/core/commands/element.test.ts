import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearHistory, execute, setActiveStage, undo, useHistory } from './engine';
import { SetInlineStyleGroupCommand, SetInnerHtmlCommand } from './element';
import { composeSlideDocument } from '../document/compose';
import { useDocumentStore } from '../document/store';
import { buildProject } from '../../import/pipeline';
import { StageBridge } from '../../stage/bridge';

// jsdom ships no CSS.escape; both target WebViews have it.
if (typeof CSS === 'undefined') {
  globalThis.CSS = { escape: (value: string) => value } as never;
}

const DECK = `<!doctype html>
<html>
  <body>
    <section class="slide">
      <h1 id="a" style="color: rgb(255, 0, 0)">見出し</h1>
      <p id="b">本文</p>
    </section>
  </body>
</html>`;

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

describe('SetInlineStyleGroupCommand', () => {
  let bridge: StageBridge;
  let doc: Document;

  beforeEach(() => {
    document.body.innerHTML = '';
    ({ bridge, doc } = mountStage());
  });

  const heading = () => doc.querySelector('h1') as HTMLElement;
  const body = () => doc.querySelector('p') as HTMLElement;
  const uids = () => [bridge.uidOf(heading())!, bridge.uidOf(body())!];

  it('writes every target as one step', () => {
    const [a, b] = uids();
    execute(new SetInlineStyleGroupCommand({ [a]: { 'text-align': 'center' }, [b]: { 'text-align': 'center' } }));

    expect(heading().style.textAlign).toBe('center');
    expect(body().style.textAlign).toBe('center');

    undo();
    expect(heading().style.textAlign).toBe('');
    expect(body().style.textAlign).toBe('');
  });

  // Reverting has to restore "there was nothing here", not the empty string:
  // a leftover `text-align:` in the markup would ride out to the exported HTML.
  it('leaves no residue behind on undo', () => {
    const [a] = uids();
    execute(new SetInlineStyleGroupCommand({ [a]: { 'text-align': 'center', 'padding-left': '0' } }));
    undo();

    expect(heading().getAttribute('style')).toBe('color: rgb(255, 0, 0);');
  });

  it('keeps a value the element already had', () => {
    const [a] = uids();
    execute(new SetInlineStyleGroupCommand({ [a]: { color: 'rgb(0, 0, 255)' } }));
    expect(heading().style.color).toBe('rgb(0, 0, 255)');

    undo();
    expect(heading().style.color).toBe('rgb(255, 0, 0)');
  });

  describe('merging', () => {
    const command = (targets: Record<string, Record<string, string>>) =>
      new SetInlineStyleGroupCommand(targets);

    it('folds a second pass over the same nodes and properties', () => {
      const [a, b] = uids();
      const first = command({ [a]: { 'text-align': 'left' }, [b]: { 'text-align': 'left' } });
      expect(first.tryMerge(command({ [a]: { 'text-align': 'center' }, [b]: { 'text-align': 'center' } }))).toBe(true);
    });

    // A different set of nodes means the markup moved underneath — taking a
    // list off, say — and the captured "before" no longer describes it.
    it('refuses when the nodes differ', () => {
      const [a, b] = uids();
      const first = command({ [a]: { 'text-align': 'left' } });
      expect(first.tryMerge(command({ [b]: { 'text-align': 'left' } }))).toBe(false);
      expect(first.tryMerge(command({ [a]: { 'text-align': 'left' }, [b]: { 'text-align': 'left' } }))).toBe(false);
    });

    it('refuses when one node’s properties differ', () => {
      const [a] = uids();
      const first = command({ [a]: { 'text-align': 'left' } });
      expect(first.tryMerge(command({ [a]: { 'text-align': 'left', 'padding-left': '0' } }))).toBe(false);
    });
  });
});

/**
 * How coarse one text step is.
 *
 * Everything a text session records goes through the same door — the element's
 * markup, measured against the last thing put on the stack — so this is where
 * "the user typed a word" and "the user pressed U" have to be told apart. They
 * were not: two formatting presses a moment apart folded into a single step and
 * one ⌘Z took both off (measured in the app at 150ms between presses).
 *
 * The commits below are hand-rolled rather than driven through
 * `commitTextSession`, deliberately. That function lives in
 * core/editing/richText.ts behind a module-scoped session, and what is being
 * pinned here is the command's own rule; the flush is reproduced in the three
 * lines it actually is (reindex, read, record the difference) so a change to
 * either side shows up as a failure in the file that owns it.
 */
describe('SetInnerHtmlCommand: what folds into one step', () => {
  let bridge: StageBridge;
  let doc: Document;
  /** The markup as of the last step already on the stack. */
  let baseline: string;

  beforeEach(() => {
    document.body.innerHTML = '';
    ({ bridge, doc } = mountStage());
    // The stack's timestamps are read off `Date.now()`, and the whole question
    // is what happens *inside* the merge window. Held still so the tests can
    // step it themselves.
    vi.useFakeTimers();
    bridge.reindex();
    baseline = box().innerHTML;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const box = () => doc.querySelector('p') as HTMLElement;
  const steps = () => useHistory.getState().undoStack.length;

  /** What `commitTextSession` does: stamp uids, then record what has changed. */
  function commit(): void {
    bridge.reindex();
    const html = box().innerHTML;
    if (html === baseline) return;
    const before = baseline;
    baseline = html;
    execute(new SetInnerHtmlCommand(bridge.uidOf(box())!, before, html), { alreadyApplied: true });
  }

  /** Long enough to be a second press, far short of the 800ms window. */
  function shortly(): void {
    vi.setSystemTime(Date.now() + 150);
  }

  it('folds a run of typing into one step', () => {
    box().textContent = '本文あ';
    commit();
    shortly();
    box().textContent = '本文あい';
    commit();

    expect(steps()).toBe(1);
    // And the fold kept the *first* `before`: one ⌘Z lands before the run
    // started, not one character back into it.
    undo();
    expect(box().innerHTML).toBe('本文');
  });

  // The bug. `execCommand` mints an element, `reindex` stamps a uid on it, and
  // that new uid is what says this flush was an act of its own rather than more
  // of the same typing.
  it('keeps two formatting presses apart, 150ms or not', () => {
    box().innerHTML = '<u>本文</u>';
    commit();
    shortly();
    box().innerHTML = '<s><u>本文</u></s>';
    commit();

    expect(steps()).toBe(2);
    undo();
    expect(box().innerHTML).toContain('<u');
    expect(box().innerHTML).not.toContain('<s');
  });

  // The mirror of the press above, and not free: a press that *unformats* mints
  // nothing at all, so "did this flush add a node?" would call it typing and
  // fold it in. `sameElements` asks whether the set is the same, which catches
  // the node going as well as coming — pressing U and then U again to take the
  // underline back has to cost two steps, not one.
  it('keeps a press that removes an element apart from the one that made it', () => {
    box().innerHTML = '<u>本文</u>';
    commit();
    shortly();
    box().innerHTML = '本文';
    commit();

    expect(steps()).toBe(2);
    undo();
    expect(box().innerHTML).toContain('<u');
  });

  it('does not absorb a formatting press into the typing before it', () => {
    box().textContent = '本文あ';
    commit();
    shortly();
    box().innerHTML = '<u>本文あ</u>';
    commit();

    expect(steps()).toBe(2);
  });

  // The size field's run: the first keystroke wraps the text in a span
  // (`setFontSize` via execCommand), every one after it only re-tunes the
  // `font-size` on that same span (`retuneSizedSpans`). Nothing is minted or
  // removed, so the run stays the one step the user means by "サイズを 30 に
  // した" — which is why only the incoming half of the pair is examined.
  it('lets a re-tune of the same nodes join the step that made them', () => {
    box().innerHTML = '<span style="font-size: 20px">本文</span>';
    commit();
    shortly();
    (box().querySelector('span') as HTMLElement).style.fontSize = '30px';
    commit();

    expect(steps()).toBe(1);
  });

  it('starts a new step once the window has passed', () => {
    box().textContent = '本文あ';
    commit();
    vi.setSystemTime(Date.now() + 1000);
    box().textContent = '本文あい';
    commit();

    expect(steps()).toBe(2);
  });
});
