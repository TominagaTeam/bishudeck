import { beforeEach, describe, expect, it } from 'vitest';

import { clearHistory, setActiveStage } from '../core/commands/engine';
import { composeSlideDocument } from '../core/document/compose';
import { useDocumentStore } from '../core/document/store';
import { useSelectionStore } from '../core/selection/store';
import { forgetTextBox, insertTextBox } from '../core/editing/textBox';
import { TEXT_BOX_SIZE, defaultPlacement } from '../core/editing/shapes';
import { buildProject } from '../import/pipeline';
import { StageBridge } from '../stage/bridge';
import { type ElementKind, type PanelId, offeredPanels, panelsFor } from './inspectorLayout';

// jsdom ships no CSS.escape; both target WebViews have it.
if (typeof CSS === 'undefined') {
  globalThis.CSS = { escape: (value: string) => value } as never;
}

/** Everything a `<div>` with words in it offers: every panel there is. */
const ALL: readonly PanelId[] = ['geometry', 'box', 'border', 'image', 'text'];
/** What a plain shape offers — no crop, no words. */
const SHAPE: readonly PanelId[] = ['geometry', 'box', 'border'];
/** A photo: croppable, but with no text of its own. */
const PHOTO: readonly PanelId[] = ['geometry', 'box', 'border', 'image'];
/** A text box. */
const TEXT: readonly PanelId[] = ['geometry', 'box', 'border', 'text'];

const slots = (kind: ElementKind, enabled: readonly PanelId[] = ALL, inSession = false) =>
  panelsFor(kind, enabled, {}, inSession);

const ids = (kind: ElementKind, enabled: readonly PanelId[] = ALL, inSession = false) =>
  slots(kind, enabled, inSession).map((slot) => slot.id);

/** The panels that can be worked, in the order they are drawn. */
const liveIds = (kind: ElementKind, enabled: readonly PanelId[] = ALL, inSession = false) =>
  slots(kind, enabled, inSession)
    .filter((slot) => slot.enabled)
    .map((slot) => slot.id);

/** The panels that are drawn but greyed out, in the order they are drawn. */
const darkIds = (kind: ElementKind, enabled: readonly PanelId[] = ALL, inSession = false) =>
  slots(kind, enabled, inSession)
    .filter((slot) => !slot.enabled)
    .map((slot) => slot.id);

const openIds = (
  kind: ElementKind,
  enabled: readonly PanelId[],
  folded: Record<string, boolean> = {},
  inSession = false,
) =>
  panelsFor(kind, enabled, folded, inSession)
    .filter((slot) => slot.open)
    .map((slot) => slot.id);

/**
 * The inspector used to give every element the same five expanded panels, and
 * the ordering is the half of the problem that could not be solved by hiding
 * fields — 余白 and 枠線 apply to a photo, they are just not why anyone
 * selected one.
 */
describe('panel order', () => {
  it('leads with the panel the element was probably selected for', () => {
    expect(ids('text', TEXT)[0]).toBe('text');
    expect(ids('image', PHOTO)[0]).toBe('image');
    expect(ids('shape', SHAPE)[0]).toBe('geometry');
  });

  it('puts the live panels first, in the order the table names them', () => {
    expect(liveIds('shape', SHAPE)).toEqual(['geometry', 'box', 'border']);
    expect(liveIds('text', TEXT)).toEqual(['text', 'geometry', 'box', 'border']);
    expect(liveIds('image', PHOTO)).toEqual(['image', 'geometry', 'box', 'border']);
  });

  /** A row states a priority; it is not a whitelist. An element that somehow
   *  offers a panel the row never named must still be able to reach it. */
  it('keeps an unnamed panel live rather than losing it', () => {
    const drawn = panelsFor('shape', ['geometry', 'box', 'border', 'text'], {}, false);
    const text = drawn.find((slot) => slot.id === 'text');
    expect(text?.enabled).toBe(true);
    expect(text?.open).toBe(false);
  });

  it('draws every panel exactly once, whatever the element is', () => {
    for (const [kind, enabled] of [
      ['text', TEXT],
      ['image', PHOTO],
      ['shape', SHAPE],
    ] satisfies [ElementKind, readonly PanelId[]][]) {
      const drawn = ids(kind, enabled);
      expect(new Set(drawn).size).toBe(drawn.length);
      expect(new Set(drawn)).toEqual(new Set(ALL));
    }
  });
});

/**
 * The panels an element has nothing for are drawn anyway, greyed out at the end
 * of the column. A pane that changes shape with the selection
 * asks the user to remember what a photo "has"; one that greys the difference
 * out shows it. What the earlier rule got right is kept — they are last, they
 * are shut, and they cost one row each rather than their contents.
 */
describe('what is drawn but cannot be worked', () => {
  it('greys out the panels the element has nothing for', () => {
    expect(darkIds('shape', SHAPE)).toEqual(['image', 'text']);
    expect(darkIds('image', PHOTO)).toEqual(['text']);
    expect(darkIds('text', TEXT)).toEqual(['image']);
  });

  it('leaves nothing dark for an element that offers everything', () => {
    expect(darkIds('text', ALL)).toEqual([]);
    expect(liveIds('text', ALL).length).toBe(ALL.length);
  });

  it('puts them after every live panel', () => {
    const drawn = slots('shape', SHAPE);
    const lastLive = drawn.findLastIndex((slot) => slot.enabled);
    const firstDark = drawn.findIndex((slot) => !slot.enabled);
    expect(lastLive).toBeLessThan(firstDark);
  });

  it('never opens one', () => {
    expect(slots('shape', SHAPE).filter((slot) => !slot.enabled && slot.open)).toEqual([]);
  });

  /** The record of what the user folded is about the *live* column. A dark
   *  panel that read it would reopen on a photo because of something done to a
   *  text box — and since its summary does not answer a click, nothing could
   *  shut it again. */
  it('stays shut whatever the user folded by hand', () => {
    const drawn = panelsFor('shape', SHAPE, { text: true, image: true }, false);
    expect(drawn.filter((slot) => !slot.enabled).map((slot) => slot.open)).toEqual([false, false]);
  });
});

/**
 * Two open at a time is the budget: about what the pane shows at its default
 * 280px without scrolling, so what greets a new selection stays this table's
 * decision rather than the window height's. Dark panels cost a
 * summary each and never open, so they do not spend it.
 */
describe('what starts open', () => {
  it('opens two panels, never the whole column', () => {
    expect(openIds('text', TEXT)).toEqual(['text', 'geometry']);
    expect(openIds('image', PHOTO)).toEqual(['image', 'geometry']);
    expect(openIds('shape', SHAPE)).toEqual(['geometry', 'box']);
  });
});

/**
 * The overrides hold only the panels the user actually worked, which is what
 * keeps the table above alive: recording a state for all five would mean one
 * click on 枠線 froze the column, and selecting a photo would never bring 画像
 * to the top again.
 */
describe('what the user folded by hand', () => {
  it('beats the default, in both directions', () => {
    const drawn = panelsFor('shape', SHAPE, { geometry: false, border: true }, false);
    expect(drawn.find((slot) => slot.id === 'geometry')?.open).toBe(false);
    expect(drawn.find((slot) => slot.id === 'border')?.open).toBe(true);
  });

  it('leaves the untouched panels on the default', () => {
    const drawn = panelsFor('shape', SHAPE, { border: true }, false);
    expect(drawn.find((slot) => slot.id === 'box')?.open).toBe(true);
  });

  /** The one that matters: an override taken on a shape must not decide what a
   *  photo opens with, beyond the panel it was actually set on. */
  it('does not flatten the ordering for the next element', () => {
    expect(openIds('image', PHOTO)).toEqual(['image', 'geometry']);
    expect(openIds('image', PHOTO, { border: true })).toEqual(['image', 'geometry', 'border']);
  });
});

/**
 * 位置とサイズ is the one panel a mode takes the power out of, and the reason is
 * this: the box is read once per commit and typing commits nothing, so
 * during a text session the X / Y / 幅 / 高さ on screen are not merely beside the
 * point, they are stale. It goes dark rather than staying live — a shut panel
 * whose summary does not open is a panel with no route to a wrong number.
 */
describe('inside a text session', () => {
  it('takes the power out of 位置とサイズ', () => {
    expect(liveIds('text', TEXT, true)).toEqual(['text', 'box', 'border']);
    expect(darkIds('text', TEXT, true)).toContain('geometry');
  });

  it('still draws it, at the end of the column', () => {
    expect(ids('text', TEXT, true)).toContain('geometry');
    const drawn = slots('text', TEXT, true);
    expect(drawn.findIndex((slot) => slot.id === 'geometry')).toBeGreaterThan(
      drawn.findLastIndex((slot) => slot.enabled),
    );
  });

  /** The trap the old rule warned about, in its new form: `panelsFor` puts
   *  anything the row does not name back among the live panels, so filtering
   *  `ordered` alone would return 位置とサイズ live and collapsed. */
  it('does not let the unnamed-panel clause make it live again', () => {
    for (const kind of ['text', 'image', 'shape'] satisfies ElementKind[]) {
      expect(liveIds(kind, ALL, true)).not.toContain('geometry');
    }
  });

  /** The half that needed warning about: a session must not lose to what the user
   *  folded by hand, and must not leave a record of its own. */
  it('beats a remembered override rather than losing to it', () => {
    const drawn = panelsFor('text', ALL, { geometry: true }, true);
    const geometry = drawn.find((slot) => slot.id === 'geometry');
    expect(geometry?.enabled).toBe(false);
    expect(geometry?.open).toBe(false);
  });

  it('leaves the same column behind once the session ends', () => {
    const folded = { geometry: false, border: true };
    const before = panelsFor('text', ALL, folded, false);
    panelsFor('text', ALL, folded, true);
    expect(panelsFor('text', ALL, folded, false)).toEqual(before);
    expect(folded).toEqual({ geometry: false, border: true });
  });

  /** Only that one. ボックス and 枠線 still describe the box while its words are
   *  being edited, and 文字書式 is the whole point of being in a session. */
  it('dims 位置とサイズ and nothing else', () => {
    for (const kind of ['text', 'image', 'shape'] satisfies ElementKind[]) {
      const outside = new Set(liveIds(kind, ALL));
      const inside = new Set(liveIds(kind, ALL, true));
      expect([...outside].filter((id) => !inside.has(id))).toEqual(['geometry']);
      expect([...inside].filter((id) => !outside.has(id))).toEqual([]);
    }
  });

  /** "Two open" is a budget, not a quota: with 位置とサイズ dark, 文字書式 is
   *  the only thing worth arriving expanded. */
  it('opens 文字書式 alone', () => {
    expect(openIds('text', TEXT, {}, true)).toEqual(['text']);
  });

  /**
   * The report this rule is for: 文字書式 was in the column, first, and folded
   * — because a fold is remembered until it is undone by hand, and one taken on
   * another element's column weeks ago is still in force. A session is a mode
   * the user entered with one panel in mind, so the mode wins for its length,
   * exactly as it does for 位置とサイズ one describe block up.
   */
  it('opens 文字書式 even when the user had folded it away', () => {
    const drawn = panelsFor('text', TEXT, { text: false }, true);
    expect(drawn.find((slot) => slot.id === 'text')?.open).toBe(true);
  });

  /** Only 文字書式, and only while the session is open. The other folds are
   *  still the user's, and the record itself is never written to. */
  it('leaves the other panels on what the user folded them to', () => {
    const folded = { text: false, box: true, border: true };
    const drawn = panelsFor('text', TEXT, folded, true);
    expect(drawn.find((slot) => slot.id === 'box')?.open).toBe(true);
    expect(drawn.find((slot) => slot.id === 'border')?.open).toBe(true);
    expect(folded.text).toBe(false);
    expect(panelsFor('text', TEXT, folded, false).find((slot) => slot.id === 'text')?.open).toBe(
      false,
    );
  });

  /**
   * 画像 is named in the shape row, so a box that can take a picture gets the
   * panel above 枠線 rather than at the bottom of the column. It arrives shut:
   * the two open panels are still 位置とサイズ and ボックス, which is the budget
   * this table spends.
   */
  it('puts 画像 above 枠線 for a box that can take a picture', () => {
    const FILLABLE: readonly PanelId[] = ['geometry', 'box', 'border', 'image'];
    expect(liveIds('shape', FILLABLE)).toEqual(['geometry', 'box', 'image', 'border']);
    expect(openIds('shape', FILLABLE)).toEqual(['geometry', 'box']);
  });

  /** A panel that is dark is dark, session or no session: an element with no
   *  text of its own has no session to be in, and the forced-open rule must not
   *  be the one thing that reopens a panel `panelsFor` just greyed out. */
  it('does not force open a 文字書式 the element has nothing for', () => {
    const drawn = panelsFor('shape', SHAPE, {}, true);
    const text = drawn.find((slot) => slot.id === 'text');
    expect(text?.enabled).toBe(false);
    expect(text?.open).toBe(false);
  });
});

/**
 * What the *element* offers, as opposed to how the offer is ordered.
 *
 * These need a real stage rather than a handful of nodes, because the answer
 * for one of them is not a property of the element at all: the box just
 * inserted is an empty `<div>` like any other, and what makes 文字書式 live on
 * it is the insertion still being on record (core/editing/textBox.ts).
 */
describe('what the element offers', () => {
  const DECK = `<!doctype html>
<html>
  <body>
    <section class="slide"><h1 class="headline">タイトル</h1><div class="frame"><div class="caption">写真添付エリア</div></div></section>
  </body>
</html>`;

  const PLACE = defaultPlacement(1280, 720, TEXT_BOX_SIZE.width, TEXT_BOX_SIZE.height);

  /** Wires a real stage to the real stores, the way EditStage does on load. */
  function mountStage() {
    const project = buildProject(DECK, 'generic');
    useDocumentStore.getState().loadProject(project, null);
    clearHistory();

    const html = composeSlideDocument(project.shared, project.slides[0]!, { mode: 'edit' });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const bridge = new StageBridge(doc, () => {
      useDocumentStore.getState().setSlideHtml(project.slides[0]!.id, bridge.serializeSlide());
    });
    setActiveStage(bridge);
    return { bridge, doc };
  }

  beforeEach(() => {
    useSelectionStore.getState().clear();
    forgetTextBox();
  });

  it('gives an element with words of its own the text column', () => {
    const { bridge, doc } = mountStage();
    const heading = doc.querySelector('h1')!;
    const uid = bridge.uidOf(heading);

    expect(offeredPanels(uid, heading)).toEqual({
      kind: 'text',
      enabled: ['geometry', 'box', 'border', 'text'],
    });
  });

  /**
   * The bug this pair is here for. A text box is inserted empty by design, so
   * `isTextEditable` says no to it — and the pane used to take that as final,
   * which put 文字書式 dark at the bottom of the column, under 画像, for the
   * one element on the slide the user had just asked for in order to type into
   * it. Double-clicking it opened a session all the same (the stage makes the
   * exception at every door), so the session ran with every control for the
   * text being typed greyed out.
   */
  it('gives the box just inserted the text column, empty though it is', () => {
    const { bridge } = mountStage();

    insertTextBox(PLACE);
    const uid = useSelectionStore.getState().uid!;
    const box = bridge.resolve(uid)!;

    expect(box.textContent).toBe('');
    expect(offeredPanels(uid, box).kind).toBe('text');
    expect(offeredPanels(uid, box).enabled).toContain('text');
  });

  /**
   * And only that box. Widening the rule to "any empty element" is the option
   * that was refused: the childless full-bleed `<div>` a
   * generated deck paints its background on is empty too, and the same test
   * decides what counts as background.
   */
  it('does not extend the exception to any other empty element', () => {
    const { bridge, doc } = mountStage();
    const theirs = doc.createElement('div');
    doc.querySelector('.slide')!.append(theirs);
    bridge.reindex();
    const theirUid = bridge.uidOf(theirs);

    insertTextBox(PLACE);

    expect(offeredPanels(theirUid, theirs).kind).toBe('shape');
    expect(offeredPanels(theirUid, theirs).enabled).not.toContain('text');
  });

  /**
   * 画像 has a second way of being live, and it is not a kind. A photo frame an
   * imported deck left behind is a box with a caption in it and no picture:
   * nothing to crop, so the column stays a shape's, but 画像を入れる
   * has something to act on — which is what makes the panel worth drawing.
   */
  it('offers 画像 to a box a picture can be put into', () => {
    const { bridge, doc } = mountStage();
    const frame = doc.querySelector('.frame')!;
    const uid = bridge.uidOf(frame);

    expect(offeredPanels(uid, frame)).toEqual({
      kind: 'shape',
      enabled: ['geometry', 'box', 'border', 'image'],
    });
  });

  /** And not to the half of the same frame a click in the middle lands on:
   *  the caption carries the author's words, so filling it would delete them. */
  it('does not offer 画像 to the caption inside that box', () => {
    const { bridge, doc } = mountStage();
    const caption = doc.querySelector('.caption')!;
    const uid = bridge.uidOf(caption);

    expect(offeredPanels(uid, caption).enabled).not.toContain('image');
  });

  /** A selection the stage can no longer resolve keeps the three panels that
   *  never needed to read it, and asks nothing of the record. */
  it('falls back to the panels that need no element', () => {
    mountStage();

    expect(offeredPanels(null, null)).toEqual({
      kind: 'shape',
      enabled: ['geometry', 'box', 'border'],
    });
  });
});
