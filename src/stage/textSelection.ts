/**
 * Selecting text with the pointer, driven from the host.
 *
 * The stage document runs no scripts, and WebKit will not fire a listener in
 * such a document even when the host attached it — so nothing that happens
 * *inside* the frame can be observed. What the host can still do is make the
 * frame do things: `focus()`, `caretRangeFromPoint()` and the Selection API all
 * work when called from outside (docs/adr/0002-edit-preview-separation.md).
 *
 * That asymmetry is why selection is drawn here rather than left to the
 * browser. Left to it, a press that lands inside an existing range starts a
 * *native drag of that range* instead of a new selection, and there is no way
 * to call `preventDefault()` on it from the host — the whole of issues #17.
 * With the press caught on a host element the frame never sees it, so the drag
 * cannot start on any engine, and the selection is built by hand from the
 * points the pointer passes through.
 *
 * The cost is that everything `contenteditable` gave away for free — caret
 * placement, word on the second press, the whole element on the third, shift to
 * extend — is spelled out here. Dragging selected text to move it is gone;
 * that was the trade (decisions.md #67).
 */

/** Resolves a point in stage coordinates to a caret position in the frame. */
export type CaretResolver = (x: number, y: number) => Range | null;

/** How long after a press a second one still belongs to the same run. */
const MULTI_PRESS_MS = 400;

/** How far the pointer may wander between presses and still count as a repeat. */
const MULTI_PRESS_SLOP = 4;

interface Edge {
  node: Node;
  offset: number;
}

interface PressRun {
  at: number;
  x: number;
  y: number;
  presses: number;
}

export class TextSelectionController {
  #element: HTMLElement;
  #resolveCaret: CaretResolver;
  /** The end that stays put while the pointer moves. */
  #anchor: Edge | null = null;
  /** The last point that resolved inside the element; kept for drags that leave it. */
  #focus: Edge | null = null;
  #dragging = false;
  #run: PressRun | null = null;

  constructor(element: HTMLElement, resolveCaret: CaretResolver) {
    this.#element = element;
    this.#resolveCaret = resolveCaret;
  }

  get dragging(): boolean {
    return this.#dragging;
  }

  /**
   * A press. `at` is the timestamp used to tell a repeat from a fresh press —
   * `PointerEvent.detail` is 0 by specification, so the count cannot be read
   * off the event and has to be kept here.
   */
  begin(x: number, y: number, options: { at: number; shift: boolean }): void {
    const selection = this.#selection();
    if (!selection) return;

    const presses = this.#countPress(x, y, options.at);
    this.#dragging = true;

    // Shift means "keep what this selection is anchored to, move its far end",
    // so the point under the pointer is a focus and never an anchor.
    if (options.shift) {
      if (!this.#anchor) this.#readAnchor(selection);
      this.extendTo(x, y);
      return;
    }

    if (presses >= 3) {
      selection.selectAllChildren(this.#element);
      this.#readAnchor(selection);
      return;
    }

    const caret = this.#caretAt(x, y);
    if (!caret) return;
    // One call, not `removeAllRanges` + `addRange` — `placeCaret` below carries
    // why the frame must never be left with no selection at all.
    selection.collapse(caret.startContainer, caret.startOffset);
    if (presses === 2) selectWordAt(selection);
    this.#readAnchor(selection);
  }

  /** The pointer moved with the button down. */
  extendTo(x: number, y: number): void {
    const selection = this.#selection();
    const anchor = this.#anchor;
    if (!selection || !anchor) return;

    const caret = this.#caretAt(x, y);
    // Dragging past the element's edge is normal — it is how a selection is
    // taken to the end of a line. The last position that *was* inside stands
    // in for the ones that are not, so the range stops growing instead of
    // collapsing or jumping into a neighbouring element.
    const focus = caret ? { node: caret.startContainer, offset: caret.startOffset } : this.#focus;
    if (!focus) return;

    this.#focus = focus;
    selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
  }

  end(): void {
    this.#dragging = false;
  }

  #selection(): Selection | null {
    return this.#element.ownerDocument.defaultView?.getSelection() ?? null;
  }

  /** A caret at this point, or null if the point is not in the edited element. */
  #caretAt(x: number, y: number): Range | null {
    const range = this.#resolveCaret(x, y);
    if (!range) return null;
    return this.#element.contains(range.startContainer) ? range : null;
  }

  #readAnchor(selection: Selection): void {
    if (!selection.anchorNode) return;
    this.#anchor = { node: selection.anchorNode, offset: selection.anchorOffset };
    this.#focus = selection.focusNode
      ? { node: selection.focusNode, offset: selection.focusOffset }
      : this.#anchor;
  }

  /**
   * 1, 2, 3, 1, 2, 3… A fourth press starts a new run rather than doing
   * nothing, which is what every text field does.
   */
  #countPress(x: number, y: number, at: number): number {
    const run = this.#run;
    const repeat =
      run !== null &&
      at - run.at <= MULTI_PRESS_MS &&
      Math.abs(x - run.x) <= MULTI_PRESS_SLOP &&
      Math.abs(y - run.y) <= MULTI_PRESS_SLOP;

    const presses = repeat ? (run.presses % 3) + 1 : 1;
    this.#run = { at, x, y, presses };
    return presses;
  }
}

/**
 * Gives the frame's element the focus a caret needs, called from the host.
 *
 * A caret is painted for the *focused* element of the *focused* frame, and the
 * host has just spent two presses taking focus the other way: every press on
 * the stage ends with `layerRef.current.focus()` (EditStage), so by the time a
 * double-click opens a session the host's focused element is
 * `.stage-interaction` — outside the frame entirely.
 *
 * `element.focus()` on its own is enough to undo all of that in Chromium, which
 * is why this was one line for as long as Chromium was the only engine anyone
 * measured on. WebKit keeps the three facts apart, and the element's own is the
 * one that matters least: with the host still focused on the layer it draws the
 * frame's selection as an *inactive* one — no caret, and grey rather than blue
 * where there is a range. The frame is same-origin (`srcdoc` under
 * `sandbox="allow-same-origin"`), so the host can set all three itself; only
 * `allow-scripts` is withheld, and nothing here needs the frame to run anything
 * (ADR-0002, and design.md's "the host can make the frame do things").
 *
 * Outside in, and the element last: focusing a frame resets that frame's own
 * focused element to its body, so an `element.focus()` before either of the
 * other two would be thrown away by them.
 *
 * That the host's focus is what decides this can be seen on Chromium too, which
 * is the only engine there is any way to measure here: with a session open and
 * the caret blinking, focusing `.stage-interaction` by hand puts the frame back
 * to `activeElement: BODY` and `hasFocus(): false`, the caret stops being drawn
 * — and the selection is still there, untouched, offset and all. Calling this
 * brings all three back and the caret with them.
 */
export function holdTextFocus(element: HTMLElement): void {
  const view = element.ownerDocument.defaultView;

  // Reading a layout property first, because the caller has just set
  // `contenteditable="true"` on this element and both engines decide whether an
  // element can be focused from computed style. Asking for `offsetHeight`
  // flushes the recalc that attribute invalidated; without it the engine can
  // still be holding the answer from before it was editable, and `focus()` on
  // something it believes is not focusable does nothing at all.
  void element.offsetHeight;

  // 1. The iframe element, in the *host* document — this is the one that takes
  //    focus back off `.stage-interaction`.
  (view?.frameElement as HTMLElement | null)?.focus({ preventScroll: true });
  // 2. The frame's window, which is what "the focused frame" names.
  view?.focus();
  // 3. The element inside it.
  element.focus({ preventScroll: true });
}

/**
 * Opens a session with the caret under the pointer and nothing selected.
 *
 * It used to take the word there as well. Starting a session with a word
 * already selected makes the very next keystroke destructive — one character
 * replaces the word, and the user who only meant to start editing does not see
 * it coming (issues #25). The word is still one gesture away: a second
 * double-click *inside* the session takes it, which `TextSelectionController`
 * counts for itself.
 *
 * Without a point — or where the engine cannot resolve one — the caret goes to
 * the end rather than nowhere.
 */
export function placeCaret(element: HTMLElement, at?: { x: number; y: number }): void {
  const doc = element.ownerDocument;
  const selection = doc.defaultView?.getSelection();
  if (!selection) return;

  const range = at ? caretRangeAt(doc, at.x, at.y) : null;
  // `caretRangeFromPoint` answers for the whole document, not for the element
  // that asked, so the point has to be checked against the element the same way
  // `TextSelectionController` checks the ones a drag passes through. A caret
  // that lands just outside — the box's own padding, the gap between two lines,
  // a hit that resolves to the parent because the point sits on a margin — is a
  // caret in a part of the document that is *not* `contenteditable`, and a
  // selection there paints nothing and swallows every keystroke. That failure
  // is exactly the reported one ("no caret on double-click"), and it is engine-
  // dependent because the two engines round edge hits differently.
  if (!range || !element.contains(range.startContainer)) {
    selection.selectAllChildren(element);
    selection.collapseToEnd();
    return;
  }

  // `collapse` rather than `removeAllRanges` + `addRange`: the pair reaches the
  // same place, but by way of a state where the frame has no selection at all,
  // and WebKit is long reported to blur a `contenteditable` whose selection is
  // emptied — which would take the caret straight back off again. One call
  // replaces the selection instead of clearing it, so that state never exists.
  selection.collapse(range.startContainer, range.startOffset);
}

export function caretRangeAt(doc: Document, x: number, y: number): Range | null {
  // `caretRangeFromPoint` is what both WebKit and Chromium implement; the
  // standard `caretPositionFromPoint` is the Gecko spelling and neither engine
  // this app ships on has it.
  const fromPoint = (doc as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null })
    .caretRangeFromPoint;
  return typeof fromPoint === 'function' ? fromPoint.call(doc, x, y) : null;
}

/** `Selection.modify` is non-standard but is the only way to say "a word". */
function selectWordAt(selection: Selection): void {
  const modify = (selection as Selection & {
    modify?: (alter: string, direction: string, granularity: string) => void;
  }).modify;
  if (typeof modify !== 'function') return;
  try {
    modify.call(selection, 'move', 'backward', 'word');
    modify.call(selection, 'extend', 'forward', 'word');
  } catch {
    // Leaves the collapsed caret, which is a perfectly good place to start.
  }
}
