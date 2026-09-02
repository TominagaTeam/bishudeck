// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { SLIDE_ROOT_ATTRIBUTE } from '../document/compose';
import {
  clearHistory,
  execute,
  getActiveStage,
  setActiveStage,
  undo,
  useHistory,
} from '../commands/engine';
import { SetInlineStyleGroupCommand } from '../commands/element';
import { t } from '../../shared/i18n';
import { StageBridge } from '../../stage/bridge';
import {
  activeTextSession,
  applyInlineFormat,
  foldFontValues,
  onBeforeSessionEnd,
  queryCaretStyle,
  refreshFormatState,
  useCaretStyle,
  useFormatState,
  commitTextSession,
  hasSessionRange,
  resyncTextBaseline,
  setFontFamily,
  setFontSize,
  setFontWeight,
  setHighlight,
  setTextColor,
  setTextSession,
  snapshotSessionRange,
} from './richText';

/**
 * The part that broke in the real app: a native select or colour dialog takes
 * focus, WebKit drops the frame's selection, and the command then has nothing
 * to act on. The contract under test is snapshot-on-pointerdown + restore-
 * before-command. jsdom has no execCommand, so the command is a stub that
 * records what the selection looked like at the moment it ran — which is
 * exactly the thing the restore logic must get right.
 */
describe('session selection snapshot and restore', () => {
  let heading: HTMLElement;
  let executed: { text: string; collapsed: boolean }[];
  let calls: { command: string; value?: string }[];

  beforeEach(() => {
    document.body.innerHTML =
      `<section ${SLIDE_ROOT_ATTRIBUTE}><h2>今期のハイライト</h2></section>`;
    heading = document.querySelector('h2') as HTMLElement;

    const bridge = new StageBridge(document, () => {});
    setActiveStage(bridge);
    setTextSession({ uid: heading.getAttribute('data-hse-uid') as string });

    executed = [];
    calls = [];
    (document as Document & { execCommand?: unknown }).execCommand = vi.fn(
      (command: string, _ui: boolean, value?: string) => {
        // Which command ran matters as much as what it ran on: two of them
        // paint a colour behind text, and only one stops at the chosen words.
        calls.push({ command, value });
        // `styleWithCSS` is a mode switch, not an edit — it is bracketed round
        // the colour commands so they write a span instead of `<font color>`
        // — and it acts on no selection at all. Keeping it out of `executed`
        // is what lets every assertion below still read `executed[0]` and mean
        // "the selection the formatting saw".
        if (command === 'styleWithCSS') return true;
        const selection = window.getSelection();
        const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        executed.push({
          text: range ? range.toString() : '',
          collapsed: range ? range.collapsed : true,
        });
        return true;
      },
    );
  });

  afterEach(() => {
    setTextSession(null);
    setActiveStage(null);
  });

  function selectChars(from: number, to: number): void {
    const range = document.createRange();
    range.setStart(heading.firstChild as Node, from);
    range.setEnd(heading.firstChild as Node, to);
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  it('restores the snapshotted range after the selection is lost to a host control', () => {
    selectChars(0, 2);
    snapshotSessionRange();
    // The select opens, focus leaves the frame, WebKit clears the selection.
    window.getSelection()?.removeAllRanges();

    setTextColor('#ff0000');

    expect(executed).toHaveLength(1);
    expect(executed[0]).toEqual({ text: '今期', collapsed: false });
  });

  it('keeps the last usable snapshot across the second click of a select-then-apply flow', () => {
    selectChars(2, 6);
    snapshotSessionRange();
    window.getSelection()?.removeAllRanges();
    // Second pointerdown (the 適用 button): nothing selected, nothing inside
    // the element — the earlier snapshot must survive.
    snapshotSessionRange();

    setTextColor('#ff0000');

    expect(executed[0].text).toBe('のハイラ');
  });

  it('prefers a live selection inside the element over the snapshot', () => {
    selectChars(0, 2);
    snapshotSessionRange();
    // The user drags a new selection before applying.
    selectChars(4, 8);

    setTextColor('#ff0000');

    expect(executed[0].text).toBe('イライト');
  });

  it('restores a deliberately placed caret as a caret', () => {
    // A caret is intent too: formatting at a caret means "what I type next".
    selectChars(3, 3);
    snapshotSessionRange();
    window.getSelection()?.removeAllRanges();

    setTextColor('#ff0000');

    expect(executed[0].collapsed).toBe(true);
  });

  it('applies a second font without the selection being remade', () => {
    // The span rewrite discards the nodes the selection pointed at; without
    // the reselect step, the second pick would act on nothing.
    (document as Document & { execCommand?: unknown }).execCommand = vi.fn(
      (_cmd: string, _ui: boolean, value?: string) => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.getRangeAt(0).collapsed) {
          return false;
        }
        const font = document.createElement('font');
        font.setAttribute('face', value ?? '');
        selection.getRangeAt(0).surroundContents(font);
        return true;
      },
    );

    selectChars(0, 2);
    snapshotSessionRange();
    window.getSelection()?.removeAllRanges();
    setFontFamily("'FirstPick', sans-serif");
    window.getSelection()?.removeAllRanges();
    setFontFamily("'SecondPick', serif");

    const spans = Array.from(heading.querySelectorAll('span'));
    const second = spans.find((span) => span.style.fontFamily.includes('SecondPick'));
    expect(second?.textContent).toBe('今期');
  });

  it('paints a highlight with hiliteColor rather than backColor', () => {
    // `backColor` fills the block in some engines: the whole heading goes
    // yellow instead of the two characters under the selection. The choice is
    // argued at the call site and was, until now, nowhere in the tests.
    selectChars(0, 2);

    setHighlight('#ffe066');

    // Bracketed by the CSS switch: without it the engine answers `foreColor`
    // and `hiliteColor` with `<font>`, which is presentational markup the
    // slide has to carry for ever after (see `CSS_STYLED_COMMANDS`). The
    // bracket is asserted rather than filtered so that dropping it — or
    // forgetting to put the flag back — fails here.
    expect(calls).toEqual([
      { command: 'styleWithCSS', value: 'true' },
      { command: 'hiliteColor', value: '#ffe066' },
      { command: 'styleWithCSS', value: 'false' },
    ]);
  });

  it('restores the snapshotted range before highlighting', () => {
    // The highlighter reaches the frame the way the text colour does, so it
    // inherits the same hazard: the palette took focus on the way here.
    selectChars(2, 6);
    snapshotSessionRange();
    window.getSelection()?.removeAllRanges();

    setHighlight('#ffe066');

    expect(executed[0]).toEqual({ text: 'のハイラ', collapsed: false });
  });

  it('does nothing without a session', () => {
    setTextSession(null);
    setTextColor('#ff0000');
    expect(executed).toHaveLength(0);
  });
});

/**
 * What a session leaves in the undo stack.
 *
 * Formatting records a step as it runs, and closing the session records what was
 * typed after it — two writers on the same element, which used to record the
 * same span of edits each: an undo took everything back, and the next one
 * appeared to do nothing at all. The contract under test is that the session
 * carries one baseline and both writers measure from it.
 */
describe('undo steps across a session', () => {
  let heading: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML =
      `<section ${SLIDE_ROOT_ATTRIBUTE}><h2>今期のハイライト</h2></section>`;
    heading = document.querySelector('h2') as HTMLElement;

    const bridge = new StageBridge(document, () => {});
    setActiveStage(bridge);
    clearHistory();
    setTextSession({ uid: heading.getAttribute('data-hse-uid') as string });

    // The one effect of execCommand that matters here: it wraps what it styles,
    // so the element's markup is not what it was.
    (document as Document & { execCommand?: unknown }).execCommand = vi.fn(() => {
      heading.innerHTML = `<b>${heading.innerHTML}</b>`;
      return true;
    });
  });

  afterEach(() => {
    setTextSession(null);
    setActiveStage(null);
    clearHistory();
    vi.useRealTimers();
  });

  /** Past the engine's merge window, so each step stands on its own. */
  function pause(): void {
    vi.advanceTimersByTime(1000);
  }

  it('records a format once, and not again when the session closes', () => {
    applyInlineFormat('bold');
    expect(heading.textContent).toBe('今期のハイライト');
    // Stamped on the way past: a node execCommand minted is addressable, which
    // is what lets a later click find it.
    expect(heading.querySelector('b')?.getAttribute('data-hse-uid')).toBeTruthy();
    pause();

    // What EditStage does on the way out of a session.
    commitTextSession();

    expect(useHistory.getState().undoStack).toHaveLength(1);
    undo();
    expect(heading.innerHTML).toBe('今期のハイライト');
    expect(useHistory.getState().canUndo).toBe(false);
  });

  it('records what was typed, which produces no command of its own', () => {
    // Standing in for typing: the frame runs no scripts, so the host only ever
    // sees the markup that resulted.
    heading.innerHTML = '来期のハイライト';
    commitTextSession();

    expect(useHistory.getState().undoStack).toHaveLength(1);
    undo();
    expect(heading.innerHTML).toBe('今期のハイライト');
  });

  it('does not re-record a change undone while the session was still open', () => {
    applyInlineFormat('bold');
    pause();
    undo();
    // EditStage subscribes to the history for exactly this; here it is called
    // directly.
    resyncTextBaseline();

    commitTextSession();

    expect(useHistory.getState().undoStack).toHaveLength(0);
    // The redo has to survive: pushing a step here would throw it away.
    expect(useHistory.getState().redoStack).toHaveLength(1);
  });

  /**
   * The other half of the same subscription, and the one that cost a user their
   * words: EditStage is told about every publish, pushes included. A resync on a
   * push moves the baseline past what was typed, and the typing then belongs to
   * no step at all. The element-scope command stands in for 行揃え
   * and 太さ, which are the two controls this panel can reach mid-session.
   */
  it('keeps what was typed when an element-scope command is pushed', () => {
    heading.innerHTML = '来期のハイライト';

    execute(new SetInlineStyleGroupCommand({ [heading.getAttribute('data-hse-uid') as string]: { 'text-align': 'center' } }));
    // What EditStage does on every publish, push or not.
    resyncTextBaseline();
    pause();

    commitTextSession();

    expect(useHistory.getState().undoStack).toHaveLength(2);
    undo();
    expect(heading.innerHTML).toBe('今期のハイライト');
    undo();
    expect(heading.style.textAlign).toBe('');
  });

  /** Flushing first is what keeps those two steps in that order. Undoing the
   *  typing replaces the markup and hands out fresh uids, so a style step
   *  recorded underneath it would no longer find the nodes it captured. */
  it('records the typing under the command when the panel flushes first', () => {
    heading.innerHTML = '来期のハイライト';

    // What TextFormatControls does before an element-scope edit.
    commitTextSession();
    pause();
    execute(new SetInlineStyleGroupCommand({ [heading.getAttribute('data-hse-uid') as string]: { 'text-align': 'center' } }));
    resyncTextBaseline();

    const stack = useHistory.getState().undoStack;
    expect(stack).toHaveLength(2);
    expect(stack[0].label).toBe(t('command.editText'));
  });
});

/**
 * The bug this guards: `execCommand` mints nodes, and a node without a uid is
 * invisible to every click. Inline wrappers hid it — the selection climb walks
 * past a `<b>` to the element that owns it — but a list is block-level, so the
 * `<li>` is where a click stops, and a bulleted line could not be selected or
 * edited again.
 */
describe('uids on what formatting creates', () => {
  let heading: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML =
      `<section ${SLIDE_ROOT_ATTRIBUTE}><h2>今期のハイライト</h2></section>`;
    heading = document.querySelector('h2') as HTMLElement;
    setActiveStage(new StageBridge(document, () => {}));
    clearHistory();
    setTextSession({ uid: heading.getAttribute('data-hse-uid') as string });
    (document as Document & { execCommand?: unknown }).execCommand = vi.fn(() => {
      heading.innerHTML = `<ul><li>${heading.innerHTML}</li></ul>`;
      return true;
    });
  });

  afterEach(() => {
    setTextSession(null);
    setActiveStage(null);
    clearHistory();
  });

  it('stamps the list a bullet command builds, so it can be clicked again', () => {
    applyInlineFormat('insertUnorderedList');

    const item = heading.querySelector('li') as HTMLElement;
    expect(item.textContent).toBe('今期のハイライト');
    expect(item.getAttribute('data-hse-uid')).toBeTruthy();
    expect(heading.querySelector('ul')?.getAttribute('data-hse-uid')).toBeTruthy();
    // Addressable is the point: the stage has to be able to resolve it back.
    expect(getActiveStage()?.resolve(item.getAttribute('data-hse-uid') as string)).toBe(item);
  });
});

/**
 * A list command says whether text is a list, not how it looks — but both
 * engines slip the list's own look into the markup on the way out: removing a
 * list wraps what comes out in a span carrying the size it had *inside* it. In
 * a deck styling `ul` at 26px, a 44px heading that was bulleted and un-bulleted
 * comes back 26px, and the deck's `h2` rule no longer reaches it.
 */
describe('what a list command leaves behind', () => {
  let heading: HTMLElement;

  function open(markup: string): void {
    document.body.innerHTML = `<section ${SLIDE_ROOT_ATTRIBUTE}>${markup}</section>`;
    heading = document.querySelector('h2') as HTMLElement;
    setActiveStage(new StageBridge(document, () => {}));
    clearHistory();
    setTextSession({ uid: heading.getAttribute('data-hse-uid') as string });
  }

  /** Stands in for the engine: whatever it is told to leave in the element. */
  function engineWrites(html: string): void {
    (document as Document & { execCommand?: unknown }).execCommand = vi.fn(() => {
      heading.innerHTML = html;
      return true;
    });
  }

  afterEach(() => {
    setTextSession(null);
    setActiveStage(null);
    clearHistory();
  });

  it('drops the size the engine pinned on the way out of a list', () => {
    open('<h2>今期のハイライト</h2>');
    engineWrites('<span style="font-size: 26px;">今期のハイライト</span>');

    applyInlineFormat('insertUnorderedList');

    expect(heading.innerHTML).toBe('今期のハイライト');
  });

  it('keeps a span that only restates styling the text already had', () => {
    // Applying a list can rebuild a span the user set, which arrives looking
    // just as new as residue does. What tells them apart is that this one says
    // nothing the markup was not already saying.
    open('<h2><span style="font-size: 40px;">今期のハイライト</span></h2>');
    engineWrites('<ul><li><span style="font-size: 40px;">今期のハイライト</span></li></ul>');

    applyInlineFormat('insertOrderedList');

    expect(heading.querySelector('span')?.style.fontSize).toBe('40px');
  });

  it('never touches a span the deck wrote, whatever it declares', () => {
    // A class is a hook the deck may be selecting on; unwrapping it would edit
    // someone's markup to save an attribute.
    open('<h2>今期の<span class="brand">ハイライト</span></h2>');
    engineWrites('<span class="brand" style="font-size: 26px;">ハイライト</span>');

    applyInlineFormat('insertUnorderedList');

    expect(heading.querySelector('span.brand')).not.toBeNull();
  });

  it('puts the selection back on the same characters', () => {
    // The engine keeps the user's selection across its own rewrite; tidying the
    // markup afterwards must not be what drops it. Without this the caret fell
    // to the top of the element and the next keystroke landed there.
    open('<h2>今期のハイライト</h2>');
    const selection = window.getSelection() as Selection;
    (document as Document & { execCommand?: unknown }).execCommand = vi.fn(() => {
      heading.innerHTML = '<span style="font-size: 26px;">今期のハイライト</span>';
      const text = heading.querySelector('span')!.firstChild as Node;
      const kept = document.createRange();
      kept.setStart(text, 2);
      kept.setEnd(text, 7);
      selection.removeAllRanges();
      selection.addRange(kept);
      return true;
    });

    applyInlineFormat('insertUnorderedList');

    expect(heading.innerHTML).toBe('今期のハイライト');
    expect(String(selection)).toBe('のハイライ');
  });

  it('leaves what other formatting produces alone', () => {
    // Bold-off writes `font-weight: normal`, which is the user asking for it.
    open('<h2>今期のハイライト</h2>');
    engineWrites('<span style="font-weight: normal;">今期のハイライト</span>');

    applyInlineFormat('bold');

    expect(heading.querySelector('span')).not.toBeNull();
  });

  // Aligning a box and then bulleting it has to land where bulleting it and
  // then aligning it does. The list arrives with no alignment of its own, and
  // inheriting the box's does not survive the trip.
  it('carries the box’s alignment onto the list it just built', () => {
    open('<h2 style="text-align: center">今期のハイライト</h2>');
    engineWrites('<ul><li>今期のハイライト</li></ul>');

    applyInlineFormat('insertUnorderedList');

    const list = heading.querySelector('ul') as HTMLElement;
    const item = heading.querySelector('li') as HTMLElement;
    expect(list.style.textAlign).toBe('center');
    expect(item.style.textAlign).toBe('center');
    expect(list.style.listStylePosition).toBe('inside');
  });

  it('writes nothing onto a list built inside a box nobody aligned', () => {
    open('<h2>今期のハイライト</h2>');
    engineWrites('<ul><li>今期のハイライト</li></ul>');

    applyInlineFormat('insertUnorderedList');

    expect(heading.querySelector('ul')?.getAttribute('style') ?? '').toBe('');
  });
});

/**
 * A deck styles its own headings, so text is usually bold before anyone touches
 * it. A B button that does not light up reads as "make this bold" while what it
 * would do is take the deck's weight off — which is how "書式が当たらない" got
 * reported for a heading the engine considered bold all along.
 */
describe('what the buttons show', () => {
  let heading: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML =
      `<section ${SLIDE_ROOT_ATTRIBUTE}><h2 style="font-weight:700">今期のハイライト</h2></section>`;
    heading = document.querySelector('h2') as HTMLElement;
    setActiveStage(new StageBridge(document, () => {}));
    setTextSession({ uid: heading.getAttribute('data-hse-uid') as string });
  });

  afterEach(() => {
    setTextSession(null);
    setActiveStage(null);
  });

  it('reports the formats the engine says are on at the caret', () => {
    (document as Document & { queryCommandState?: unknown }).queryCommandState = vi.fn(
      (command: string) => command === 'bold',
    );

    refreshFormatState();

    expect(useFormatState.getState()).toEqual({
      bold: true,
      italic: false,
      underline: false,
      strikeThrough: false,
      superscript: false,
      insertUnorderedList: false,
      insertOrderedList: false,
    });
  });

  // The 段落 buttons had no state to read at all, so a line that was already a
  // bullet looked exactly like one that was not.
  it('reports whether the caret sits on a list', () => {
    (document as Document & { queryCommandState?: unknown }).queryCommandState = vi.fn(
      (command: string) => command === 'insertUnorderedList',
    );

    refreshFormatState();

    expect(useFormatState.getState().insertUnorderedList).toBe(true);
    expect(useFormatState.getState().insertOrderedList).toBe(false);
  });

  // 上付き was the one toggle nobody asked the engine about, so the button could
  // not light up however the text was formatted.
  it('reports whether the caret sits in superscript', () => {
    (document as Document & { queryCommandState?: unknown }).queryCommandState = vi.fn(
      (command: string) => command === 'superscript',
    );

    refreshFormatState();

    expect(useFormatState.getState().superscript).toBe(true);
  });

  it('forgets everything when the session closes', () => {
    (document as Document & { queryCommandState?: unknown }).queryCommandState = vi.fn(() => true);
    refreshFormatState();
    expect(useFormatState.getState().bold).toBe(true);

    setTextSession(null);

    // Otherwise the buttons of a closed session stay lit against the next one.
    expect(useFormatState.getState()).toEqual({});
  });

  it('says nothing when there is no session', () => {
    setTextSession(null);
    (document as Document & { queryCommandState?: unknown }).queryCommandState = vi.fn(() => true);

    refreshFormatState();

    expect(useFormatState.getState()).toEqual({});
  });
});

/**
 * The size field applies as it is typed, so `setFontSize` runs once per digit.
 * Going through `execCommand` every time would
 * nest a span inside the last one, and the innermost — the one nearest the text
 * — would win: the slide would stop following the field after the first digit.
 */
describe('a size typed digit by digit', () => {
  let heading: HTMLElement;
  let execCommand: Mock<() => boolean>;

  function open(markup: string): void {
    document.body.innerHTML = `<section ${SLIDE_ROOT_ATTRIBUTE}>${markup}</section>`;
    heading = document.querySelector('h2') as HTMLElement;
    setActiveStage(new StageBridge(document, () => {}));
    clearHistory();
    setTextSession({ uid: heading.getAttribute('data-hse-uid') as string });

    // The legacy 1–7 scale is all the engine speaks: it wraps what is selected
    // in `<font size="7">`, which the module rewrites to a span carrying px.
    execCommand = vi.fn(() => {
      heading.innerHTML = `<font size="7">${heading.innerHTML}</font>`;
      return true;
    });
    (document as Document & { execCommand?: unknown }).execCommand = execCommand;
    selectAll();
  }

  function selectAll(): void {
    const range = document.createRange();
    range.selectNodeContents(heading);
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  afterEach(() => {
    setTextSession(null);
    setActiveStage(null);
    clearHistory();
  });

  it('re-tunes the span it already made instead of wrapping again', () => {
    open('<h2>今期のハイライト</h2>');

    setFontSize(3);
    setFontSize(36);

    const spans = heading.querySelectorAll('span');
    expect(spans).toHaveLength(1);
    expect((spans[0] as HTMLElement).style.fontSize).toBe('36px');
    // Wrapped on the first digit only; the second just rewrote the declaration.
    expect(execCommand).toHaveBeenCalledTimes(1);
  });

  it('goes back through the engine once the selection has moved on', () => {
    open('<h2>今期のハイライト</h2>');
    setFontSize(30);

    // Clicking back into the text moves the caret, and the pointerdown that
    // then lands on the panel snapshots wherever it went (EditStage).
    const text = heading.querySelector('span')?.firstChild as Node;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 2);
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);
    snapshotSessionRange();

    setFontSize(36);

    expect(execCommand).toHaveBeenCalledTimes(2);
  });

  it('drops a size the text already carried, which would otherwise win', () => {
    open('<h2><span class="lead" style="font-size: 12px;">今期のハイライト</span></h2>');

    setFontSize(30);

    expect((heading.firstElementChild as HTMLElement).style.fontSize).toBe('30px');
    // The deck's own span stays; only the declaration that would have beaten
    // the new size goes (the line `dropPreservationSpans` draws too).
    const lead = heading.querySelector('span.lead') as HTMLElement;
    expect(lead).not.toBeNull();
    expect(lead.style.fontSize).toBe('');
  });

  it('folds a run of digits into one undo step', () => {
    open('<h2>今期のハイライト</h2>');

    setFontSize(3);
    setFontSize(36);

    expect(useHistory.getState().undoStack).toHaveLength(1);
    undo();
    expect(heading.innerHTML).toBe('今期のハイライト');
  });
});

/**
 * A caret is not a range, and the two commands that work by rewriting a legacy
 * element have nothing to rewrite at one.
 *
 * Measured in the running app before it was written down: with the caret in a
 * box and 48 typed into the size field, nothing changed — and then typing left
 * `<font>XY</font>` in the slide, because `execCommand` had armed the engine's
 * *pending* style and the element it mints only appears on the next keystroke,
 * long after the rewrite pass has run. The size that pending style carries is
 * the legacy one (48px for `7`) whatever number the user typed, and it is
 * discarded anyway as soon as the size field takes focus back. So the command
 * cannot keep the promise, and what it can do instead is not lie in the markup.
 */
describe('a size or family asked for at a bare caret', () => {
  let heading: HTMLElement;
  let execCommand: Mock<() => boolean>;

  function open(markup: string): void {
    document.body.innerHTML = `<section ${SLIDE_ROOT_ATTRIBUTE}>${markup}</section>`;
    heading = document.querySelector('h2') as HTMLElement;
    setActiveStage(new StageBridge(document, () => {}));
    clearHistory();
    setTextSession({ uid: heading.getAttribute('data-hse-uid') as string });
    execCommand = vi.fn(() => true);
    (document as Document & { execCommand?: unknown }).execCommand = execCommand;
  }

  function putCaret(offset: number): void {
    const range = document.createRange();
    range.setStart(heading.firstChild as Node, offset);
    range.collapse(true);
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  afterEach(() => {
    setTextSession(null);
    setActiveStage(null);
    clearHistory();
  });

  it('leaves the engine alone when the size field is used at a caret', () => {
    open('<h2>今期のハイライト</h2>');
    putCaret(3);
    snapshotSessionRange();

    setFontSize(48);

    expect(execCommand).not.toHaveBeenCalled();
    expect(heading.innerHTML).toBe('今期のハイライト');
    expect(useHistory.getState().undoStack).toHaveLength(0);
  });

  it('leaves the engine alone when a font is picked at a caret', () => {
    open('<h2>今期のハイライト</h2>');
    putCaret(3);
    snapshotSessionRange();

    setFontFamily("'Georgia', serif");

    expect(execCommand).not.toHaveBeenCalled();
    expect(heading.innerHTML).toBe('今期のハイライト');
  });

  it('is not fooled by the caret the frame manufactures on focus', () => {
    // The snapshot is the last thing the user pointed at, and it outranks a
    // live collapsed caret for the same reason `prepareSelection` distrusts
    // one: focusing a contenteditable makes a caret out of nothing.
    open('<h2>今期のハイライト</h2>');
    const range = document.createRange();
    range.setStart(heading.firstChild as Node, 0);
    range.setEnd(heading.firstChild as Node, 2);
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);
    snapshotSessionRange();
    // The size field takes the focus and WebKit drops the frame's selection.
    selection.removeAllRanges();

    expect(hasSessionRange()).toBe(true);
  });

  it('reports a caret as nothing to format', () => {
    open('<h2>今期のハイライト</h2>');
    putCaret(3);
    snapshotSessionRange();

    expect(hasSessionRange()).toBe(false);
  });
});

/**
 * The rewrite sweep is the editor reaching into the DOM by hand, and it has to
 * stop at the box it was invited into. `<font size="7">` is a tag the editor
 * mints on purpose, but it is also ordinary HTML that an imported deck can
 * already contain — and a document-wide sweep would rewrite that stranger's
 * markup to whatever number this field is holding, which is precisely the
 * "don't rewrite the deck's own CSS" line this editor draws.
 */
describe('the sweep that rewrites the engine output', () => {
  it('rewrites only the fonts inside the box being edited', () => {
    document.body.innerHTML =
      `<section ${SLIDE_ROOT_ATTRIBUTE}>` +
      `<h2>今期のハイライト</h2>` +
      `<p><font size="7">デッキが元から持っていた文字</font></p>` +
      `</section>`;
    const heading = document.querySelector('h2') as HTMLElement;
    setActiveStage(new StageBridge(document, () => {}));
    clearHistory();
    setTextSession({ uid: heading.getAttribute('data-hse-uid') as string });
    (document as Document & { execCommand?: unknown }).execCommand = vi.fn(() => {
      heading.innerHTML = `<font size="7">${heading.innerHTML}</font>`;
      return true;
    });
    const range = document.createRange();
    range.selectNodeContents(heading);
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);

    setFontSize(40);

    expect((heading.firstElementChild as HTMLElement).style.fontSize).toBe('40px');
    const stranger = document.querySelector('p font');
    expect(stranger).not.toBeNull();
    expect(stranger?.getAttribute('size')).toBe('7');

    setTextSession(null);
    setActiveStage(null);
    clearHistory();
  });
});

/**
 * What repeated runs of the size field leave in the markup.
 *
 * The engine does not reuse the span the last run wrote — it empties it and
 * wraps again — so without a sweep the box gains a dead `<span style="">` every
 * time a size is set, one nested inside the last. Nothing about the slide looks
 * different, and all of it is exported.
 */
describe('the husks left by a second run of the size field', () => {
  let heading: HTMLElement;

  function open(markup: string): void {
    document.body.innerHTML = `<section ${SLIDE_ROOT_ATTRIBUTE}>${markup}</section>`;
    heading = document.querySelector('h2') as HTMLElement;
    setActiveStage(new StageBridge(document, () => {}));
    clearHistory();
    setTextSession({ uid: heading.getAttribute('data-hse-uid') as string });
    // The engine's shape, as observed in Chromium: the old span is emptied of
    // its declaration rather than reused, and a fresh `<font>` goes inside it.
    (document as Document & { execCommand?: unknown }).execCommand = vi.fn(() => {
      for (const span of Array.from(heading.querySelectorAll('span'))) {
        (span as HTMLElement).style.removeProperty('font-size');
      }
      const target = heading.firstElementChild ?? heading;
      target.innerHTML = `<font size="7">${target.innerHTML}</font>`;
      return true;
    });
    const range = document.createRange();
    range.selectNodeContents(heading);
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  afterEach(() => {
    setTextSession(null);
    setActiveStage(null);
    clearHistory();
  });

  it('unwraps the span the previous run left empty', () => {
    open('<h2>今期のハイライト</h2>');

    setFontSize(40);
    const range = document.createRange();
    range.selectNodeContents(heading);
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);
    setFontSize(12);

    const spans = heading.querySelectorAll('span');
    expect(spans).toHaveLength(1);
    expect((spans[0] as HTMLElement).style.fontSize).toBe('12px');
    expect(heading.textContent).toBe('今期のハイライト');
  });

  it('leaves the deck its own element, and only takes the husk off it', () => {
    // A span the deck put there may be what its CSS selects; unwrapping it
    // would change the slide. The emptied attribute still goes.
    open('<h2><span class="lead" style="font-size: 12px;">今期のハイライト</span></h2>');

    setFontSize(40);

    const lead = heading.querySelector('span.lead') as HTMLElement;
    expect(lead).not.toBeNull();
    expect(lead.hasAttribute('style')).toBe(false);
  });
});

/**
 * The half of the caret read that jsdom cannot host.
 *
 * `getComputedStyle` there resolves next to nothing — there is no layout and no
 * cascade worth the name — so a test of the real reader would be measuring
 * jsdom rather than this decision. What is worth pinning down is what the panel
 * should show once the values are in hand, and that is a pure fold.
 */
describe('folding the values sampled across a range', () => {
  const values = (...triples: [string, string, string][]) =>
    triples.map(([fontSize, fontFamily, fontWeight]) => ({ fontSize, fontFamily, fontWeight }));

  it('reports the value when the whole range agrees', () => {
    expect(foldFontValues(values(['64px', 'Georgia, serif', '700']))).toEqual({
      fontSize: 64,
      fontFamily: 'Georgia, serif',
      fontWeight: 700,
    });
  });

  // PowerPoint blanks a field whose selection holds more than one value, and so
  // does this: showing the first would invite the user to leave a size alone
  // believing the whole selection already had it.
  it('says nothing about a property the range disagrees on', () => {
    const mixed = foldFontValues(
      values(['200px', 'Georgia, serif', '700'], ['64px', 'Georgia, serif', '700']),
    );
    expect(mixed.fontSize).toBeNull();
    // Decided one property at a time: two sizes in one family still name the
    // family, which is the field the user can still act on.
    expect(mixed.fontFamily).toBe('Georgia, serif');
    expect(mixed.fontWeight).toBe(700);
  });

  // A deck writes the keyword and an engine answers with the number; a `<b>`
  // and a `<span style="font-weight:700">` in one selection are one weight, and
  // reading them as two would blank a field that has a single answer.
  it('reads the keywords as the numbers they stand for', () => {
    expect(foldFontValues(values(['64px', 'serif', 'bold'], ['64px', 'serif', '700'])).fontWeight)
      .toBe(700);
    expect(foldFontValues(values(['64px', 'serif', 'normal'])).fontWeight).toBe(400);
  });

  it('says nothing about a value it cannot read as a number', () => {
    // `lighter` is relative to the parent and no engine reports it computed;
    // guessing a number out of it would put a weight on the slide nobody chose.
    expect(foldFontValues(values(['64px', 'serif', 'lighter'])).fontWeight).toBeNull();
    // Anything not in px is a length this field cannot represent (the line
    // `parsePixels` draws for the inspector's other numbers).
    expect(foldFontValues(values(['2em', 'serif', '400'])).fontSize).toBeNull();
  });

  it('has nothing to say about an empty sample', () => {
    expect(foldFontValues([])).toEqual({ fontSize: null, fontFamily: null, fontWeight: null });
  });
});

/**
 * Which elements the caret read asks about — the half that is this module's
 * judgement rather than the engine's.
 *
 * The bug it exists for: the panel seeded サイズ / フォント / 太さ once per
 * element and never again, so moving the caret from a word blown up to 200px
 * back into 64px text left the field reading 200, and the next thing typed
 * there resized the wrong run. Reading the *session element* would be the same
 * bug in a new place, because a size set on three words lives on a span inside
 * the box.
 */
describe('what the caret read looks at', () => {
  let heading: HTMLElement;

  function open(markup: string): void {
    document.body.innerHTML = `<section ${SLIDE_ROOT_ATTRIBUTE}>${markup}</section>`;
    heading = document.querySelector('h2') as HTMLElement;
    setActiveStage(new StageBridge(document, () => {}));
    setTextSession({ uid: heading.getAttribute('data-hse-uid') as string });
  }

  /** Stands in for the engine: each element answers with what it declares. */
  function computedFrom(sizes: Map<Element, string>): void {
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      (node: Element) =>
        ({
          fontSize: sizes.get(node) ?? '64px',
          fontFamily: 'Georgia, serif',
          fontWeight: '400',
        }) as CSSStyleDeclaration,
    );
  }

  afterEach(() => {
    vi.restoreAllMocks();
    setTextSession(null);
    setActiveStage(null);
  });

  it('reads the element the caret is actually standing in', () => {
    open('<h2><span style="font-size: 200px">大</span>きい見出し</h2>');
    const big = heading.querySelector('span') as HTMLElement;
    computedFrom(new Map([[big, '200px']]));

    const caret = document.createRange();
    caret.setStart(big.firstChild as Node, 1);
    caret.collapse(true);
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(caret);

    expect(queryCaretStyle().fontSize).toBe(200);
  });

  it('follows the caret out of that run and back into the box', () => {
    open('<h2><span style="font-size: 200px">大</span>きい見出し</h2>');
    const big = heading.querySelector('span') as HTMLElement;
    computedFrom(new Map([[big, '200px']]));

    const caret = document.createRange();
    caret.setStart(heading.lastChild as Node, 2);
    caret.collapse(true);
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(caret);

    expect(queryCaretStyle().fontSize).toBe(64);
  });

  it('blanks the size when the selection covers both', () => {
    open('<h2><span style="font-size: 200px">大</span>きい見出し</h2>');
    const big = heading.querySelector('span') as HTMLElement;
    computedFrom(new Map([[big, '200px']]));

    const range = document.createRange();
    range.selectNodeContents(heading);
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);

    const style = queryCaretStyle();
    expect(style.fontSize).toBeNull();
    // The two properties the run does agree on still have their answer.
    expect(style.fontFamily).toBe('Georgia, serif');
    expect(style.fontWeight).toBe(400);
  });

  it('keeps describing the run once a host control has taken the focus', () => {
    // The size field takes focus on every keystroke and WebKit drops the
    // frame's selection; the fields must go on describing what is about to be
    // formatted rather than blanking the moment the user reaches for them.
    open('<h2><span style="font-size: 200px">大きい</span>見出し</h2>');
    const big = heading.querySelector('span') as HTMLElement;
    computedFrom(new Map([[big, '200px']]));

    const range = document.createRange();
    range.selectNodeContents(big);
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);
    snapshotSessionRange();
    selection.removeAllRanges();

    expect(queryCaretStyle().fontSize).toBe(200);
  });

  it('publishes what it reads on the same poll the buttons use', () => {
    // No second timer in EditStage: the poll that keeps B lit is what makes the
    // value fields follow the caret.
    open('<h2><span style="font-size: 200px">大</span>きい見出し</h2>');
    const big = heading.querySelector('span') as HTMLElement;
    computedFrom(new Map([[big, '200px']]));
    const caret = document.createRange();
    caret.setStart(big.firstChild as Node, 0);
    caret.collapse(true);
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(caret);

    refreshFormatState();
    expect(useCaretStyle.getState().fontSize).toBe(200);

    setTextSession(null);
    // Otherwise the last session's numbers sit in the fields of the next one.
    expect(useCaretStyle.getState()).toEqual({
      fontSize: null,
      fontFamily: null,
      fontWeight: null,
    });
  });

  it('publishes the same object while nothing has changed', () => {
    // Five reads a second, and the panel holds a number field: a fresh object
    // every time re-renders it between two keystrokes.
    open('<h2>今期のハイライト</h2>');
    computedFrom(new Map());
    const caret = document.createRange();
    caret.setStart(heading.firstChild as Node, 1);
    caret.collapse(true);
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(caret);

    refreshFormatState();
    const first = useCaretStyle.getState();
    refreshFormatState();

    expect(useCaretStyle.getState()).toBe(first);
  });

  it('says nothing when there is no session', () => {
    open('<h2>今期のハイライト</h2>');
    computedFrom(new Map());
    setTextSession(null);

    expect(queryCaretStyle()).toEqual({ fontSize: null, fontFamily: null, fontWeight: null });
  });
});

/**
 * 太さ used to be the one character format that ignored the selection: the panel
 * wrote it on the element, so choosing 400 with three words selected produced
 * `<h1 style="font-weight: 400">` and stripped the weight off the whole line
 * (measured in the app). The range-scoped half is here; the element-scoped one
 * is untouched and still what an edit outside a session goes through.
 */
describe('a weight chosen for a range', () => {
  let heading: HTMLElement;

  function open(markup: string): void {
    document.body.innerHTML = `<section ${SLIDE_ROOT_ATTRIBUTE}>${markup}</section>`;
    heading = document.querySelector('h2') as HTMLElement;
    setActiveStage(new StageBridge(document, () => {}));
    clearHistory();
    setTextSession({ uid: heading.getAttribute('data-hse-uid') as string });
    // Nothing here goes through the engine, which is the point: there is no
    // command for a numeric weight, and the two that mint `<font>` would strip
    // the very property they are asked about off everything inside the range.
    (document as Document & { execCommand?: unknown }).execCommand = vi.fn(() => {
      throw new Error('a weight must not reach execCommand');
    });
  }

  function select(from: number, to: number, node: Node = heading.firstChild as Node): void {
    const range = document.createRange();
    range.setStart(node, from);
    range.setEnd(node, to);
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  afterEach(() => {
    setTextSession(null);
    setActiveStage(null);
    clearHistory();
  });

  it('wraps the selected characters and leaves the box alone', () => {
    open('<h2 style="font-weight: 700">今期のハイライト</h2>');

    select(2, 6);
    setFontWeight('400');

    const span = heading.querySelector('span') as HTMLElement;
    expect(span.textContent).toBe('のハイラ');
    expect(span.style.fontWeight).toBe('400');
    // The bug in one line: the deck's own heading weight stays where it is.
    expect(heading.style.fontWeight).toBe('700');
    expect(heading.textContent).toBe('今期のハイライト');
  });

  it('takes the weight off a word the B button had bolded', () => {
    // The wrap goes *inside* the `<b>`, so the span holding the letters is the
    // innermost element over them and the UA's bold rule no longer reaches
    // them. Nothing is unwrapped: `<b>` is meaning the user (or the deck) put
    // there, and this is an override.
    open('<h2>今期の<b>ハイ</b>ライト</h2>');

    const range = document.createRange();
    range.selectNodeContents(heading);
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);
    setFontWeight('400');

    const bolded = heading.querySelector('b') as HTMLElement;
    expect(bolded).not.toBeNull();
    expect((bolded.firstElementChild as HTMLElement).style.fontWeight).toBe('400');
  });

  it('re-tunes the span it already made instead of nesting another', () => {
    open('<h2>今期のハイライト</h2>');

    select(2, 6);
    setFontWeight('700');
    setFontWeight('400');

    const spans = heading.querySelectorAll('span');
    expect(spans).toHaveLength(1);
    expect((spans[0] as HTMLElement).style.fontWeight).toBe('400');
  });

  it('drops the weight a wrapper over the same words no longer says', () => {
    // The retune cannot fire once the user has clicked back into the text, so
    // without this the same run gains a dead declaration on every visit.
    open('<h2>今期のハイライト</h2>');
    select(2, 6);
    setFontWeight('700');

    const span = heading.querySelector('span') as HTMLElement;
    select(0, span.textContent?.length ?? 0, span.firstChild as Node);
    setFontWeight('400');

    expect(heading.textContent).toBe('今期のハイライト');
    const weights = Array.from(heading.querySelectorAll('span')).map(
      (node) => (node as HTMLElement).style.fontWeight,
    );
    expect(weights.filter(Boolean)).toEqual(['400']);
  });

  it('leaves the deck its own span when the wrapper is not the editor’s', () => {
    // A class is a hook the deck may be selecting on, so the wrapper keeps
    // whatever it says even about exactly these characters.
    open('<h2><span class="lead" style="font-weight: 700">今期のハイライト</span></h2>');
    const lead = heading.querySelector('span.lead') as HTMLElement;

    select(0, 8, lead.firstChild as Node);
    setFontWeight('300');

    expect(lead.style.fontWeight).toBe('700');
    expect((lead.firstElementChild as HTMLElement).style.fontWeight).toBe('300');
  });

  it('does nothing at a bare caret', () => {
    open('<h2>今期のハイライト</h2>');
    select(3, 3);
    snapshotSessionRange();

    setFontWeight('700');

    expect(heading.innerHTML).toBe('今期のハイライト');
    expect(useHistory.getState().undoStack).toHaveLength(0);
  });

  it('records one undo step that puts the markup back', () => {
    open('<h2>今期のハイライト</h2>');

    select(2, 6);
    setFontWeight('700');

    expect(useHistory.getState().undoStack).toHaveLength(1);
    undo();
    expect(heading.innerHTML).toBe('今期のハイライト');
  });

  it('acts on the range snapshotted before the menu took the focus', () => {
    // A `<select>` takes focus on the way to opening, and WebKit drops the
    // frame's selection with it — the same hazard the colour dialog has.
    open('<h2>今期のハイライト</h2>');
    select(2, 6);
    snapshotSessionRange();
    window.getSelection()?.removeAllRanges();

    setFontWeight('700');

    expect(heading.querySelector('span')?.textContent).toBe('のハイラ');
  });
});

/**
 * The number fields commit on Enter and on focus leaving, PowerPoint-style, and
 * one of the ways focus leaves is the click that ends the session. That click
 * closes the session from a capture-phase `pointerdown`, which runs before the
 * field's own `blur` — so a field waiting for its blur would apply to a session
 * that is already gone.
 */
describe('the last word before a session closes', () => {
  let heading: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML =
      `<section ${SLIDE_ROOT_ATTRIBUTE}><h2>今期のハイライト</h2></section>`;
    heading = document.querySelector('h2') as HTMLElement;
    setActiveStage(new StageBridge(document, () => {}));
    clearHistory();
    setTextSession({ uid: heading.getAttribute('data-hse-uid') as string });
  });

  afterEach(() => {
    setTextSession(null);
    setActiveStage(null);
    clearHistory();
  });

  it('lets a held draft land while the session is still open', () => {
    const uid = heading.getAttribute('data-hse-uid') as string;
    const seen: (string | null)[] = [];
    const off = onBeforeSessionEnd(() => {
      seen.push(activeTextSession()?.uid ?? null);
      // What a field with a pending number does: apply it as if Enter had been
      // pressed. The range it was typed for is still there to act on.
      const range = document.createRange();
      range.setStart(heading.firstChild as Node, 0);
      range.setEnd(heading.firstChild as Node, 2);
      const selection = window.getSelection() as Selection;
      selection.removeAllRanges();
      selection.addRange(range);
      setFontWeight('700');
    });

    setTextSession(null);
    off();

    expect(seen).toEqual([uid]);
    expect(heading.querySelector('span')?.style.fontWeight).toBe('700');
  });

  it('announces the switch to another box, not just the way out', () => {
    document.body.innerHTML =
      `<section ${SLIDE_ROOT_ATTRIBUTE}><h2>今期</h2><p>来期</p></section>`;
    heading = document.querySelector('h2') as HTMLElement;
    setActiveStage(new StageBridge(document, () => {}));
    setTextSession({ uid: heading.getAttribute('data-hse-uid') as string });
    const other = document.querySelector('p') as HTMLElement;

    let announced = 0;
    const off = onBeforeSessionEnd(() => {
      announced += 1;
    });

    setTextSession({ uid: other.getAttribute('data-hse-uid') as string });
    // Re-opening the same box is not a close: nothing has been lost, and a
    // flush here would apply a draft the user is still typing.
    setTextSession({ uid: other.getAttribute('data-hse-uid') as string });
    off();

    expect(announced).toBe(1);
  });

  it('says nothing to a listener that has unsubscribed', () => {
    let announced = 0;
    const off = onBeforeSessionEnd(() => {
      announced += 1;
    });
    off();

    setTextSession(null);

    expect(announced).toBe(0);
  });

  it('closes the session even when a listener throws', () => {
    // Otherwise a panel with a bug leaves the element editable with no way left
    // to end it.
    const off = onBeforeSessionEnd(() => {
      throw new Error('a panel with a bug');
    });
    let reached = false;
    const second = onBeforeSessionEnd(() => {
      reached = true;
    });

    setTextSession(null);
    off();
    second();

    expect(reached).toBe(true);
    expect(activeTextSession()).toBeNull();
  });

  it('does not announce again from inside a listener that closes the session', () => {
    let announced = 0;
    const off = onBeforeSessionEnd(() => {
      announced += 1;
      setTextSession(null);
    });

    setTextSession(null);
    off();

    expect(announced).toBe(1);
  });
});

/**
 * The boxes the list buttons did nothing to, and the one whose result did not
 * survive being saved.
 *
 * All three are hosts `execCommand` cannot leave a list in, so the fix is to
 * rebuild the host first (core/editing/listHost.ts). The engine is stubbed to
 * record whether it was called at all: for a box that is already a list the
 * right number of calls is zero — the browser's answer there is to do nothing,
 * which is the bug.
 */
describe('a list command whose host cannot hold the result', () => {
  let calls: string[];

  function open(markup: string, selector: string): void {
    document.body.innerHTML = `<section ${SLIDE_ROOT_ATTRIBUTE}>${markup}</section>`;
    const host = document.querySelector(selector) as HTMLElement;
    setActiveStage(new StageBridge(document, () => {}));
    clearHistory();
    setTextSession({ uid: host.getAttribute('data-hse-uid') as string });

    calls = [];
    (document as Document & { execCommand?: unknown }).execCommand = vi.fn((command: string) => {
      calls.push(command);
      return true;
    });
  }

  /** The box the session is on now — the same uid, whatever tag it wears. */
  function box(): HTMLElement {
    const uid = activeTextSession()?.uid as string;
    return getActiveStage()?.resolve(uid) as HTMLElement;
  }

  afterEach(() => {
    setTextSession(null);
    setActiveStage(null);
    clearHistory();
  });

  it('takes a deck’s own bulleted box out of its list', () => {
    open('<ul><li>一行目</li><li>二行目</li></ul>', 'ul');

    applyInlineFormat('insertUnorderedList');

    expect(box().tagName).toBe('DIV');
    expect(Array.from(box().children).map((child) => child.tagName)).toEqual(['DIV', 'DIV']);
    expect(box().textContent).toBe('一行目二行目');
    expect(calls).toEqual([]);
  });

  it('turns the same box into a numbered list without losing its address', () => {
    open('<ul><li>一行目</li></ul>', 'ul');
    const uid = activeTextSession()?.uid;

    applyInlineFormat('insertOrderedList');

    expect(box().tagName).toBe('OL');
    expect(box().getAttribute('data-hse-uid')).toBe(uid);
    expect(box().querySelectorAll('li')).toHaveLength(1);
    expect(calls).toEqual([]);
  });

  it('gives a paragraph a block to build the list in', () => {
    open('<p>本文です</p>', 'p');

    applyInlineFormat('insertUnorderedList');

    expect(box().tagName).toBe('DIV');
    expect(calls).toEqual(['insertUnorderedList']);
  });

  it('does the same for a span host, which Blink refuses outright', () => {
    open('<span style="display: block">本文です</span>', 'span');

    applyInlineFormat('insertUnorderedList');

    expect(box().tagName).toBe('DIV');
    expect(calls).toEqual(['insertUnorderedList']);
  });

  it('leaves a heading to the browser', () => {
    open('<h2>今期のハイライト</h2>', 'h2');

    applyInlineFormat('insertUnorderedList');

    expect(box().tagName).toBe('H2');
    expect(calls).toEqual(['insertUnorderedList']);
  });

  it('rebuilds and unwinds in one step', () => {
    open('<ul><li>一行目</li></ul>', 'ul');

    applyInlineFormat('insertOrderedList');
    expect(useHistory.getState().canUndo).toBe(true);

    undo();

    expect(document.querySelector('ol')).toBeNull();
    expect(document.querySelector('ul')?.textContent).toBe('一行目');
    expect(useHistory.getState().canUndo).toBe(false);
  });
});
