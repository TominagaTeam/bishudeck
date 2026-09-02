/**
 * Character-level formatting inside a text box.
 *
 * This is the one place `document.execCommand` earns its keep: it is the only
 * API that applies formatting to an arbitrary selection inside a contenteditable
 * region while keeping the caret where the user left it. Reimplementing range
 * splitting by hand would be far more code and worse behaved. Each call is
 * wrapped so the whole element's before/after markup becomes one undo step.
 *
 * {@link setFontWeight} is the exception that proves it: there is no command for
 * a numeric weight, `bold` being a two-valued toggle, so that one does split the
 * range itself — and the argument for why every other route is worse is written
 * out there.
 */

import { create } from 'zustand';

import { execute } from '../commands/engine';
import { SetInnerHtmlCommand } from '../commands/element';
import { getActiveStage, useHistory } from '../commands/engine';
import { withHtmlSnapshot } from './actions';
import { carryAlignmentIntoLists, fitListsIntoBox, listsIn } from './listOverrides';
import {
  anchorsOf,
  anchorsRestorableIn,
  planListCommand,
  rebuildListHost,
  type ListPlan,
  type RangeAnchors,
} from './listHost';
import { UID_ATTRIBUTE } from '../../shared/ids';
import { t } from '../../shared/i18n';

export type InlineFormat =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikeThrough'
  | 'superscript'
  | 'subscript'
  | 'insertUnorderedList'
  | 'insertOrderedList'
  | 'removeFormat';

export type BlockAlign = 'justifyLeft' | 'justifyCenter' | 'justifyRight' | 'justifyFull';

/**
 * Marks host chrome that acts on the open text session. A click anywhere else
 * in the window ends the session, so the controls that format the text being
 * edited have to be able to say "not me".
 */
export const TEXT_TOOLS_ATTRIBUTE = 'data-hse-text-tools';

/** The element currently open for text editing, if any. */
export interface TextSession {
  uid: string;
}

/** A family name no real font has, so the produced `<font>` tags are findable. */
const FONT_MARKER = 'hse-font-marker';

let session: TextSession | null = null;

/**
 * The element's markup as of the last step already on the undo stack.
 *
 * Typing produces no command of its own — keystrokes land in the frame, which
 * runs no scripts, so the host never sees them — and the markup therefore drifts
 * ahead of the history until something catches it up. Holding the point the
 * history reached is what lets a formatting command and the closing of the
 * session each record only their own span, instead of both recording the whole
 * session and leaving an undo that appears to do nothing.
 */
let baseline = '';

/**
 * The text range a host control is about to act on.
 *
 * Touching any host widget can cost the stage its selection: a native select
 * or a colour dialog takes focus, and WebKit drops the frame's range the
 * moment it goes. The range is therefore captured on the way in — EditStage
 * snapshots it on `pointerdown` over the formatting panel, before focus has
 * moved — and restored just before a command runs.
 */
let savedRange: Range | null = null;

/**
 * The open session, in a shape React can subscribe to.
 *
 * {@link activeTextSession} stays the module's own truth and is what the
 * commands read — they run inside a click handler, where a plain getter is
 * both fresher and cheaper. This mirror exists because the inspector *renders*
 * differently depending on the session: the controls that only mean something
 * inside one are not drawn outside it, and nothing would re-render to hide
 * them without a store to watch.
 */
export const useTextSession = create<{ uid: string | null }>(() => ({ uid: null }));

/**
 * Host controls with an edit that has been typed but not yet applied.
 *
 * The number fields commit PowerPoint-style — on Enter or when focus leaves —
 * and one of the ways focus leaves is a click on the canvas, which is also the
 * click that ends the session. The order is fixed and unhelpful: the session is
 * closed from a `pointerdown` listener in the capture phase (EditStage), and
 * `blur` only fires after that, by which time `activeTextSession()` is null and
 * the range the number was typed for is gone. A field that waited for its own
 * blur would apply to nothing, silently.
 *
 * So the session announces that it is about to close and gives whoever is
 * holding a draft the last moment in which applying it still means something.
 * The listeners run with the session, the element and the saved range all still
 * in place, so a listener may call {@link setFontSize} and friends exactly as if
 * the user had pressed Enter — each still records its own undo step.
 *
 * Registered here rather than exposed as a `flushDrafts()` for EditStage to
 * call, because the closing paths are not this module's to edit and there is
 * more than one of them: adding a call site to each would leave the next path
 * someone writes silently dropping drafts. One announcement at the single point
 * where the session is actually cleared cannot be forgotten.
 */
const beforeSessionEnd = new Set<() => void>();

/** Registers a listener; the returned function takes it off again. */
export function onBeforeSessionEnd(listener: () => void): () => void {
  beforeSessionEnd.add(listener);
  return () => {
    beforeSessionEnd.delete(listener);
  };
}

/** Guards against a listener that ends the session itself. */
let ending = false;

function announceSessionEnd(): void {
  if (ending) return;
  ending = true;
  try {
    for (const listener of Array.from(beforeSessionEnd)) {
      try {
        listener();
      } catch {
        // A panel that throws while flushing must not leave the session half
        // closed: the element would keep `contenteditable` and the caret, with
        // nothing left able to end it. Every other listener still gets its turn
        // and teardown continues.
      }
    }
  } finally {
    ending = false;
  }
}

export function setTextSession(next: TextSession | null): void {
  // Before anything is cleared: what a listener applies here has to land on the
  // session that is ending, not on the one replacing it.
  if (session && next?.uid !== session.uid) announceSessionEnd();

  session = next;
  savedRange = null;
  sizedSpans = [];
  weightedSpans = [];
  baseline = next ? (sessionElement()?.innerHTML ?? '') : '';
  useTextSession.setState({ uid: next?.uid ?? null });
  if (!next) {
    useFormatState.setState({}, true);
    useCaretStyle.setState(NO_CARET_STYLE, true);
  }
}

/**
 * Which inline formats are on at the caret, for the buttons to show.
 *
 * A store rather than something read while rendering, because nothing announces
 * a selection change: the stage runs no scripts, so `selectionchange` never
 * reaches the host. EditStage looks while a session is open.
 *
 * Showing it matters more here than in a word processor. A deck styles its own
 * headings, so text is very often bold before anyone touches it — and a B that
 * does not light up reads as "make this bold", while what it actually does is
 * take the deck's weight *off*. The button has to say which way it is pointing.
 */
export const useFormatState = create<Record<string, boolean>>(() => ({}));

/** The three values the panel's value-carrying fields show, as CSS spells them. */
export interface ComputedFontValues {
  fontSize: string;
  fontFamily: string;
  fontWeight: string;
}

/**
 * What those fields should show at the caret.
 *
 * `null` means "the field has nothing to say": either there is no session to
 * read, or the selection spans more than one value for that property. Blanking
 * is what PowerPoint does with a mixed run, and it is the only honest answer —
 * showing the first value would invite the user to leave it alone believing the
 * whole selection already has it, and showing the last would be as arbitrary.
 * The three are decided separately, so a selection at one size in two weights
 * still shows its size.
 */
export interface CaretStyle {
  fontSize: number | null;
  fontFamily: string | null;
  fontWeight: number | null;
}

const NO_CARET_STYLE: CaretStyle = { fontSize: null, fontFamily: null, fontWeight: null };

/**
 * What the caret is standing in, for the fields that show a *value*.
 *
 * `queryCommandState` answers yes/no and nothing else, so B / I / U had a way
 * to follow the caret and サイズ / フォント / 太さ did not: the panel seeded them
 * once per element from the box's computed style and they then sat still.
 * Measured in the running app — a heading with one word blown up to 200px still
 * read 200 with the caret back among the 64px text, so the next thing typed in
 * the field silently resized the wrong run.
 *
 * A store for the same reason {@link useFormatState} is one: the stage runs no
 * scripts, so `selectionchange` never reaches the host and nothing
 * would re-render when the caret moves. It is filled from the same 200ms poll,
 * which is what makes the fields follow the caret without EditStage growing a
 * second timer.
 */
export const useCaretStyle = create<CaretStyle>(() => NO_CARET_STYLE);

export function refreshFormatState(): void {
  // Written only when something actually differs. Both stores are refreshed
  // five times a second, and a fresh object every time re-renders every panel
  // that reads one whole — which, with a number field on screen, is a re-render
  // landing between two keystrokes.
  const formats = queryFormatState();
  if (!sameRecord(useFormatState.getState(), formats)) useFormatState.setState(formats, true);

  const style = queryCaretStyle();
  if (!sameRecord(useCaretStyle.getState(), style)) useCaretStyle.setState(style, true);
}

function sameRecord<T extends object>(a: T, b: T): boolean {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.is(left[key], right[key]));
}

/**
 * Records everything the element has gained since the last step on the stack,
 * and moves the baseline up to it. Called before and after each formatting
 * command, and once more as the session closes.
 */
export function commitTextSession(): void {
  const stage = getActiveStage();
  const element = sessionElement();
  if (!stage || !session || !element) return;

  // Typing and `execCommand` both mint nodes the editor has never seen, and a
  // node without a uid is one nothing can address: the click that resolves to
  // it finds no uid and silently does nothing. Inline wrappers hid this — the
  // selection climb walks past a `<b>` to the element that owns it — but a list
  // is block-level, so `<li>` is where the climb stops, and a bulleted line
  // became unselectable and impossible to edit again. Stamped before the markup
  // is read, so what goes on the undo stack matches what is in the DOM.
  stage.reindex();

  const html = element.innerHTML;
  if (html === baseline) return;

  const before = baseline;
  baseline = html;
  execute(new SetInnerHtmlCommand(session.uid, before, html), { alreadyApplied: true });
  stage.commit();
}

/**
 * Undo and redo rewrite the element out from under an open session. What they
 * leave behind is by definition already on the stack, so the baseline moves with
 * them — otherwise closing the session would record the step just taken back.
 *
 * With them, and with nothing else. EditStage watches the whole history store,
 * which publishes on `execute` too, and moving the baseline on a *push* hands
 * everything typed so far to a command that never touched it: the keystrokes
 * belong to neither step, and `commitTextSession` then finds nothing left to
 * record. Typing a word and pressing 行揃え used to leave one step on the
 * stack, and undoing it gave back the alignment but not the word.
 *
 * `lastAt` is the stamp `execute` writes and `undo` / `redo` / `revoke` clear,
 * so the store already draws the line — there is no second field to keep in
 * sync with it, and a caller cannot forget to pass a flag it does not have.
 */
export function resyncTextBaseline(): void {
  if (useHistory.getState().lastAt !== 0) return;
  const element = sessionElement();
  if (session && element) baseline = element.innerHTML;
}

/**
 * Remembers the stage's current selection. Call while it still exists: on
 * `pointerdown` over host chrome, focus has not yet left the frame.
 *
 * A collapsed caret inside the element is saved too — a caret the user placed
 * is intent, and formatting at a caret is the "applies to what I type next"
 * behaviour. A selection that is missing or outside the element means focus is
 * already off in host chrome (the second click of a select-then-apply flow),
 * so the previous snapshot stays: it is still what the user is acting on.
 */
export function snapshotSessionRange(): void {
  const element = sessionElement();
  const selection = element?.ownerDocument.defaultView?.getSelection();
  if (!element || !selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  if (!element.contains(range.commonAncestorContainer)) return;
  savedRange = range.cloneRange();
}

function sessionElement(): HTMLElement | null {
  const stage = getActiveStage();
  if (!stage || !session) return null;
  const element = stage.resolve(session.uid);
  const view = element?.ownerDocument.defaultView;
  return element && view && element instanceof view.HTMLElement ? element : null;
}

/**
 * Makes the element the thing `execCommand` will act on. Focus first — the
 * frame may have lost it to the control that triggered the command — then put
 * the remembered range back unless a live, non-collapsed selection already
 * sits inside the element. A collapsed live caret is not trusted: focusing a
 * contenteditable manufactures one, and it says nothing about what the user
 * had selected when they reached for the control.
 */
function prepareSelection(element: HTMLElement): void {
  const view = element.ownerDocument.defaultView;
  const selection = view?.getSelection();
  if (!selection) return;

  element.focus({ preventScroll: true });

  if (selection.rangeCount > 0) {
    const live = selection.getRangeAt(0);
    if (!live.collapsed && element.contains(live.commonAncestorContainer)) return;
  }

  if (
    savedRange &&
    savedRange.commonAncestorContainer.isConnected &&
    element.contains(savedRange.commonAncestorContainer)
  ) {
    selection.removeAllRanges();
    selection.addRange(savedRange.cloneRange());
  }
}

export function activeTextSession(): TextSession | null {
  return session;
}

/**
 * Whether the session has a *run* of text to format, as opposed to a bare caret.
 *
 * Three of the commands here work by letting the engine mint a legacy element
 * and rewriting it — `<font size="7">` for a size, `<font face>` for a family.
 * That trick only has something to rewrite when there is text to wrap. Asked at
 * a collapsed caret, `execCommand` mints nothing at all and instead arms the
 * engine's *pending* style, which is a different thing wearing the same name:
 *
 *  - it carries the legacy value, not the one the user asked for — every size
 *    becomes whatever the engine maps `7` to (48px in both engines), so 20 and
 *    200 would land identically, and every family becomes the sentinel;
 *  - the rewrite pass runs now and the element appears later, when the user
 *    types, so nothing is ever there to rewrite — the `<font>` goes into the
 *    slide's markup and stays (measured: typing after a size set at a caret
 *    left `<font>XY</font>` in the box, which is exactly the presentational
 *    tag the "don't break the HTML" promise forbids);
 *  - and it is discarded anyway the moment focus leaves the frame, which the
 *    size field does after every keystroke (`LiveNumberInput` takes focus back
 *    so the next digit lands in it).
 *
 * So the honest answer at a caret is to do nothing, and the callers ask this
 * first. The precedence matches {@link prepareSelection}: a live range inside
 * the element is the truth, and the snapshot stands in for it once a host
 * control has taken focus and WebKit has dropped it.
 */
export function hasSessionRange(): boolean {
  const element = sessionElement();
  const range = element ? writableRange(element) : null;
  return Boolean(range && !range.collapsed);
}

/** The live selection, if there is one and it is inside the box being edited. */
function liveRange(element: HTMLElement): Range | null {
  const selection = element.ownerDocument.defaultView?.getSelection();
  const live = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  return live && element.contains(live.commonAncestorContainer) ? live : null;
}

function usableSnapshot(element: HTMLElement): Range | null {
  if (!savedRange || !savedRange.commonAncestorContainer.isConnected) return null;
  return element.contains(savedRange.commonAncestorContainer) ? savedRange : null;
}

/**
 * The range a command is about to act on — the precedence {@link prepareSelection}
 * spells out, in one place for the callers that only need to look.
 *
 * A live *collapsed* caret is not trusted here: focusing a contenteditable
 * manufactures one, and every writer focuses the element on its way in, so the
 * caret it would find may be the browser's rather than the user's.
 */
function writableRange(element: HTMLElement): Range | null {
  const live = liveRange(element);
  if (live && !live.collapsed) return live;
  return usableSnapshot(element);
}

/**
 * The range a *reader* should describe, which is the one place a bare caret is
 * worth having.
 *
 * The distinction from {@link writableRange} is deliberate. Reading happens on a
 * timer with nobody having touched the focus, so a collapsed live range is the
 * caret the user placed — and following it is the entire point of the fields
 * that show a value. Once a host control does take the focus and the engine
 * drops the frame's selection, the snapshot stands in for it, which is what
 * keeps the fields describing the run the user is about to act on rather than
 * blanking as soon as they reach for the panel.
 */
function readableRange(element: HTMLElement): Range | null {
  return liveRange(element) ?? usableSnapshot(element);
}

/**
 * The text nodes inside the box that the range covers, boundaries included.
 *
 * Walked from the session element rather than from `commonAncestorContainer`,
 * so the search cannot wander into the rest of the slide however the range was
 * built — the same line every sweep in this file draws.
 *
 * Nodes that are nothing but whitespace are left out. They carry no glyph, so
 * no format is visible on them, and they are mostly the newlines between an
 * engine's `<li>`s — sampling those would report the list's own style as a
 * second opinion and blank a field that has only one answer, and wrapping them
 * would put a `<span>` straight inside a `<ul>`.
 */
function textNodesIn(element: HTMLElement, range: Range): Text[] {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (text.data.trim() === '' || !range.intersectsNode(text)) continue;
    nodes.push(text);
  }
  return nodes;
}

export function applyInlineFormat(command: InlineFormat | BlockAlign, value?: string): void {
  run(command, value);
}

/**
 * The commands that must write CSS rather than the legacy tag they default to.
 *
 * `foreColor` left to itself emits `<font color="#ff0000">` — measured in the
 * running app, not inferred — and unlike the size and the family, nothing here
 * was rewriting it afterwards, so the tag went into the slide and out again
 * through the exporter. `styleWithCSS` is the engine's own switch for this and
 * turns the same command into `<span style="color: …">`.
 *
 * Not turned on for everything, which is the obvious next thought: it also
 * turns `bold` into `<span style="font-weight:bold">` (emphasis losing the
 * element that carries its meaning), and it turns `fontSize` into
 * `font-size: xxx-large` — a keyword off the same legacy scale, which would
 * leave {@link setFontSize} sweeping for a `<font>` that is no longer there.
 * So it is raised around these two calls and put straight back.
 */
const CSS_STYLED_COMMANDS = new Set<string>(['foreColor', 'hiliteColor']);

export function setTextColor(color: string): void {
  run('foreColor', color);
}

export function setHighlight(color: string): void {
  // `hiliteColor` is the widely supported name; `backColor` targets the block
  // in some engines, which is not what a highlighter should do.
  run('hiliteColor', color);
}

/**
 * The spans the last size edit produced, so the next one can re-tune them.
 *
 * The size field applies on every keystroke, and going through `execCommand`
 * each time would wrap the same run again and again: the innermost span is the
 * one nearest the text, so it wins, and the size would appear to stop changing
 * after the first digit. Re-tuning also keeps the frame's focus alone — the
 * `execCommand` path takes it back on every call (`prepareSelection`).
 */
let sizedSpans: HTMLElement[] = [];

export function setFontSize(px: number): void {
  const stage = getActiveStage();
  const doc = stage?.document;
  if (!doc || !session) return;

  if (retuneSizedSpans(px)) return;
  // Nothing to wrap, and the legacy command would arm a pending style carrying
  // the wrong number and leave a `<font>` behind the first time the user typed
  // (see {@link hasSessionRange}).
  if (!hasSessionRange()) return;

  // execCommand only speaks the legacy 1-7 scale, so the size is applied by
  // tagging the produced font elements and rewriting them to a real px value.
  withUndo(() => {
    doc.execCommand('fontSize', false, '7');
    // Searched inside the box, not across the document. A deck written by hand
    // — or run through some other tool on its way here — may carry a `<font
    // size="7">` of its own somewhere else on the slide, and a document-wide
    // sweep would rewrite that stranger's markup to whatever number this field
    // is holding: the editor overrides, it does not rewrite.
    const element = sessionElement() ?? doc.body;
    const spans: HTMLElement[] = [];
    for (const font of Array.from(element.querySelectorAll('font[size="7"]'))) {
      const span = doc.createElement('span');
      span.style.fontSize = `${px}px`;
      span.innerHTML = font.innerHTML;
      font.replaceWith(span);
      spans.push(span);
    }
    dropInnerFontSize(spans);
    dropEmptiedSpans(spans);
    reselect(doc, spans);
    sizedSpans = spans;
  });
}

/**
 * Re-applies the size to the spans the previous call made, when the user is
 * still pointing at exactly them — the case while a number is being typed.
 *
 * What makes it safe is the range test rather than a set of invalidation hooks:
 * `reselect` leaves the selection spanning those elements and `withUndo`
 * snapshots it, so the boundaries match only while this run of size edits is
 * still the last thing that happened. Anything else the user does — clicking
 * back into the text, formatting a different run, an undo — moves or detaches
 * them, and the caller falls back to the `execCommand` path.
 *
 * Nothing here mints a node, so the paste watcher (which only inspects added
 * nodes) needs no `formatting` flag; `commitTextSession` alone records the step,
 * and consecutive keystrokes merge into one.
 */
function retuneSizedSpans(px: number): boolean {
  const element = sessionElement();
  if (!element || sizedSpans.length === 0) return false;

  if (
    !sizedSpans.every((span) => span.isConnected && element.contains(span)) ||
    !selectionSpans(element, sizedSpans)
  ) {
    sizedSpans = [];
    return false;
  }

  for (const span of sizedSpans) span.style.fontSize = `${px}px`;
  commitTextSession();
  return true;
}

/** Whether what is selected is precisely these elements, end to end. */
function selectionSpans(element: HTMLElement, spans: HTMLElement[]): boolean {
  const doc = element.ownerDocument;
  const view = doc.defaultView;
  if (!view) return false;

  // Same precedence as `prepareSelection`: a live range inside the element is
  // the truth, and the snapshot stands in for it once a host control has taken
  // the focus and WebKit has dropped it.
  const range = writableRange(element);
  if (!range) return false;

  const expected = doc.createRange();
  expected.setStartBefore(spans[0]);
  expected.setEndAfter(spans[spans.length - 1]);
  return (
    range.compareBoundaryPoints(view.Range.START_TO_START, expected) === 0 &&
    range.compareBoundaryPoints(view.Range.END_TO_END, expected) === 0
  );
}

/**
 * Strips the size off anything *inside* a span that was just given one.
 *
 * A declaration nearer the text wins, so a run that already carried its own
 * `font-size` would keep it and the size the user picked would not show. Only
 * the declaration goes — the element stays, because it may be the deck's own
 * (`dropPreservationSpans` draws the same line for the same reason).
 */
function dropInnerFontSize(spans: HTMLElement[]): void {
  for (const span of spans) {
    for (const inner of Array.from(span.querySelectorAll('[style*="font-size"]'))) {
      (inner as HTMLElement).style.removeProperty('font-size');
    }
  }
}

/**
 * Takes out the husks a run of size edits leaves behind.
 *
 * Each pass through the engine wraps the text again, and the engine empties the
 * span the last pass wrote rather than reusing it — so setting a size three
 * times leaves `<span style=""><span style=""><span style="font-size:30px">`,
 * one dead pair deeper every time. Rendering is unaffected, which is why it
 * went unnoticed, but the markup grows without bound inside a single session
 * and every byte of it is exported — and an export that grows on every round
 * trip is exactly what this editor promises not to produce.
 *
 * `style=""` is what makes them safe to take out, and it is the whole test. A
 * deck never ships an empty style attribute — it can only be what is left when
 * something removed the last declaration — so an attribute that is present and
 * says nothing is this editor's own footprint. A bare one is unwrapped; one
 * carrying a class or an id is the deck's element wearing our leftovers, so it
 * keeps its place and only loses the attribute, which is the same line
 * `dropPreservationSpans` and `scrubStyle` both draw.
 *
 * The kept spans are passed in rather than inferred: they are the ones this
 * call just wrote a size onto, and they are about to be reselected.
 */
function dropEmptiedSpans(kept: HTMLElement[]): void {
  const element = sessionElement();
  if (!element) return;

  const keep = new Set<Element>(kept);
  // Collected first: unwrapping moves nodes, and a live list would skip some.
  for (const span of Array.from(element.querySelectorAll('span[style]'))) {
    if (keep.has(span) || (span as HTMLElement).style.length !== 0) continue;
    // Unwrapping an ancestor of a kept span moves that span up a level; it
    // stays connected, so the reselect that follows still finds it.
    if (isBareSpan(span)) span.replaceWith(...Array.from(span.childNodes));
    else span.removeAttribute('style');
  }
}

/**
 * `fontName` still emits `<font face>`. The produced elements are tagged with a
 * sentinel family and rewritten to spans, the same trick {@link setFontSize}
 * uses, so nothing presentational reaches the exported markup.
 */
export function setFontFamily(stack: string): void {
  const doc = getActiveStage()?.document;
  if (!doc || !session) return;
  // Same reason as the size: at a caret the sentinel family goes into the
  // engine's pending style, and the `<font face>` it mints on the next
  // keystroke is minted long after this rewrite has run.
  if (!hasSessionRange()) return;

  withUndo(() => {
    doc.execCommand('fontName', false, FONT_MARKER);
    const element = sessionElement() ?? doc.body;
    const spans: Element[] = [];
    for (const font of Array.from(element.querySelectorAll(`font[face="${FONT_MARKER}"]`))) {
      const span = doc.createElement('span');
      span.style.fontFamily = stack;
      span.innerHTML = font.innerHTML;
      font.replaceWith(span);
      spans.push(span);
    }
    reselect(doc, spans);
  });
}

/**
 * The spans the last weight edit produced, so a second pick re-tunes them.
 *
 * The same bookkeeping {@link sizedSpans} does, for the same reason: wrapping
 * again would nest a span inside the last one on every pick, and the innermost
 * would win. Here it also keeps the markup honest — 700 then 400 leaves one
 * span saying 400, not one saying 400 inside one saying 700.
 */
let weightedSpans: HTMLElement[] = [];

/**
 * Sets a numeric weight on the selected run.
 *
 * Weight was the one character format that stayed element-wide: the panel wrote
 * it with `SetInlineStyleGroupCommand`, so selecting three words in a heading
 * and choosing 400 produced `<h1 style="font-weight: 400">` and took the weight
 * off the whole line (measured in the app). This is the range-scoped half; the
 * element-scoped path stays exactly as it was, and choosing between them is the
 * panel's job — with no selection open, "the whole box" is still the only thing
 * a weight can sensibly mean.
 *
 * Written by wrapping the range by hand, which is the one place in this file
 * that does not lean on `execCommand`. The three alternatives were tried on
 * paper and each gives up something:
 *
 *  - `bold` knows two values, not seven, and it *toggles* — asked for 700 on a
 *    run that is already bold it un-bolds, and there is then no element to
 *    rewrite into a span. `styleWithCSS` changes what it emits, not that.
 *  - borrowing the `<font>` trick from {@link setFontSize} / {@link setFontFamily}
 *    means running `fontSize` or `fontName` for their markup alone, and both
 *    engines strip the property they are asked about off everything inside the
 *    range first. Setting a weight would silently wipe a size or a family the
 *    user had set on one word inside the selection.
 *  - `insertHTML` rebuilds the run from a string, which discards the caret and
 *    every uid inside it.
 *
 * Wrapping touches nothing but `font-weight`, which is the whole point.
 */
export function setFontWeight(weight: string | number): void {
  const doc = getActiveStage()?.document;
  if (!doc || !session) return;

  const value = String(weight).trim();
  if (!value) return;

  if (retuneWeightedSpans(value)) return;
  // A caret is not a run. Unlike the size and the family there is no pending
  // style to arm here, so nothing would be left behind — but wrapping a
  // zero-length range still produces an empty span, and "the weight of what I
  // type next" is a promise this cannot keep without a command to arm.
  if (!hasSessionRange()) return;

  withUndo(() => {
    const element = sessionElement();
    const range = element ? writableRange(element) : null;
    if (!element || !range || range.collapsed) return;

    const spans = wrapRange(element, range, (span) => {
      span.style.fontWeight = value;
    });
    if (spans.length === 0) return;
    dropShadowedWeight(spans);
    dropEmptiedSpans(spans);
    reselect(doc, spans);
    weightedSpans = spans;
  });
}

/**
 * Re-writes the weight on the spans the previous pick made, when the selection
 * is still exactly them.
 *
 * Safe for the reason `retuneSizedSpans` is: `selectionSpans` compares the
 * boundaries, so this only fires while that pick is still the last thing that
 * happened. Anything else — a click back into the text, a size edit, an undo —
 * moves or detaches them and the caller wraps afresh.
 */
function retuneWeightedSpans(value: string): boolean {
  const element = sessionElement();
  if (!element || weightedSpans.length === 0) return false;

  if (
    !weightedSpans.every((span) => span.isConnected && element.contains(span)) ||
    !selectionSpans(element, weightedSpans)
  ) {
    weightedSpans = [];
    return false;
  }

  for (const span of weightedSpans) span.style.fontWeight = value;
  commitTextSession();
  return true;
}

/**
 * Takes the weight off a wrapper that says it about exactly the same text.
 *
 * Nothing *inside* a new span can outrank it — a span is given text nodes and
 * only text nodes, so it is always the innermost element over its own
 * characters, `<b>` included (the wrap goes inside the `<b>`, not around it,
 * and the UA's bold rule applies to the `<b>` rather than to the span holding
 * the letters). That is what lets this be the whole of the tidying, and it is
 * why {@link setFontSize} needs a `dropInnerFontSize` and this does not.
 *
 * What is left is the layer above: pick 700, click away, select the same words
 * again, pick 400, and the retune below cannot fire — so the run ends up as a
 * 400 span inside a 700 one, correct on screen and one dead declaration heavier
 * every time round. It only goes when the wrapper covers exactly the same text
 * this call just wrote a weight onto, which is the case where it provably says
 * nothing any more. Nothing is unwrapped here; a wrapper emptied of its last
 * declaration is `dropEmptiedSpans`'s to judge, on its own rules.
 */
function dropShadowedWeight(spans: HTMLElement[]): void {
  const element = sessionElement();
  if (!element) return;

  for (const span of spans) {
    for (
      let above = span.parentElement;
      above && above !== element && element.contains(above);
      above = above.parentElement
    ) {
      if (above.tagName !== 'SPAN' || !isBareSpan(above)) break;
      if (above.textContent !== span.textContent) break;
      above.style.removeProperty('font-weight');
    }
  }
}

/**
 * Wraps everything the range covers in spans, and hands them back.
 *
 * The text nodes at the two ends are split so the wrap stops exactly where the
 * selection does, and neighbours that share a parent go into one span rather
 * than one each — three words selected inside a paragraph come out as a single
 * wrapper, and only a run broken up by markup the deck already had produces
 * more than one.
 *
 * The offsets are read off the range once, before any splitting: `splitText`
 * moves live boundary points, so a second read mid-way through would be asking
 * about a range that has already shifted under it.
 */
function wrapRange(
  element: HTMLElement,
  range: Range,
  decorate: (span: HTMLElement) => void,
): HTMLElement[] {
  const doc = element.ownerDocument;
  const { startContainer, startOffset, endContainer, endOffset } = range;

  const pieces: Text[] = [];
  for (const node of textNodesIn(element, range)) {
    const from = node === startContainer ? Math.min(startOffset, node.data.length) : 0;
    const to = node === endContainer ? Math.min(endOffset, node.data.length) : node.data.length;
    if (to <= from) continue;

    let piece = node;
    if (to < piece.data.length) piece.splitText(to);
    if (from > 0) piece = piece.splitText(from);
    pieces.push(piece);
  }

  const spans: HTMLElement[] = [];
  for (const group of groupSiblings(pieces)) {
    const span = doc.createElement('span');
    decorate(span);
    group[0].parentNode?.insertBefore(span, group[0]);
    for (const node of group) span.appendChild(node);
    spans.push(span);
  }
  return spans;
}

/** Runs of nodes that sit next to each other under the same parent. */
function groupSiblings(nodes: Text[]): Text[][] {
  const groups: Text[][] = [];
  for (const node of nodes) {
    const group = groups[groups.length - 1];
    const previous = group?.[group.length - 1];
    if (group && previous && previous.parentNode === node.parentNode && previous.nextSibling === node) {
      group.push(node);
    } else {
      groups.push([node]);
    }
  }
  return groups;
}

export function createLink(href: string): void {
  run('createLink', href);
}

/**
 * The commands whose state a toolbar button can show. The list pair is here for
 * the same reason B is: without it there is no way to read off
 * whether the line the caret sits on is already a bullet, so the button says
 * "make this a list" whether that is what it will do or the opposite.
 */
const QUERIED_COMMANDS = [
  'bold',
  'italic',
  'underline',
  'strikeThrough',
  'superscript',
  'insertUnorderedList',
  'insertOrderedList',
];

/** Reports which inline formats are on at the caret, for toolbar highlighting. */
export function queryFormatState(): Record<string, boolean> {
  const doc = getActiveStage()?.document;
  if (!doc || !session) return {};
  const state: Record<string, boolean> = {};
  for (const command of QUERIED_COMMANDS) {
    try {
      state[command] = doc.queryCommandState(command);
    } catch {
      state[command] = false;
    }
  }
  return state;
}

/**
 * Folds the computed values sampled across a range into what one field shows.
 *
 * Split out from the DOM walk that gathers them because it is the half worth
 * testing and the half jsdom cannot host: there is no layout there, so
 * `getComputedStyle` resolves next to nothing and a test written against the
 * real reader would be testing jsdom's cascade rather than this decision.
 */
export function foldFontValues(values: ComputedFontValues[]): CaretStyle {
  if (values.length === 0) return NO_CARET_STYLE;
  return {
    fontSize: agreed(values.map((value) => parseCssPixels(value.fontSize))),
    fontFamily: agreed(values.map((value) => value.fontFamily.trim() || null)),
    fontWeight: agreed(values.map((value) => parseCssWeight(value.fontWeight))),
  };
}

/** The one value they all carry, or null the moment two of them differ. */
function agreed<T>(values: (T | null)[]): T | null {
  const first = values[0] ?? null;
  if (first === null) return null;
  return values.every((value) => value === first) ? first : null;
}

function parseCssPixels(value: string): number | null {
  if (!value.trim().endsWith('px')) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A computed weight as a number.
 *
 * Real engines resolve `font-weight` to a number, but a deck may write the
 * keyword and jsdom hands the keyword straight back, so both spellings have to
 * arrive at the same answer — otherwise a `<b>` and a `<span style="700">` in
 * one selection would read as two different weights and blank the field.
 * `lighter` / `bolder` are relative and cannot be resolved without the parent's
 * weight; no engine reports them as computed values, and guessing one would be
 * worse than saying nothing.
 */
function parseCssWeight(value: string): number | null {
  const text = value.trim().toLowerCase();
  if (text === 'normal') return 400;
  if (text === 'bold') return 700;
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Reads the effective size / family / weight where the caret is.
 *
 * The sample is taken from the *elements that own the text*, not from the
 * session element: a size set on three words lives on a span inside the box, so
 * asking the box would answer with the deck's heading rule however the caret
 * moves — which is the bug this exists for.
 */
export function queryCaretStyle(): CaretStyle {
  const element = sessionElement();
  const view = element?.ownerDocument.defaultView;
  if (!element || !view) return NO_CARET_STYLE;

  const range = readableRange(element);
  if (!range) return NO_CARET_STYLE;

  const sampled = sampledElements(element, range);
  return foldFontValues(
    sampled.map((node) => {
      const computed = view.getComputedStyle(node);
      return {
        fontSize: computed.fontSize,
        fontFamily: computed.fontFamily,
        fontWeight: computed.fontWeight,
      };
    }),
  );
}

/** Every element inside the box that owns a piece of what the range covers. */
function sampledElements(element: HTMLElement, range: Range): HTMLElement[] {
  const owners = new Set<HTMLElement>();
  if (!range.collapsed) {
    for (const text of textNodesIn(element, range)) {
      const owner = text.parentElement;
      if (owner && element.contains(owner)) owners.add(owner);
    }
  }
  if (owners.size > 0) return Array.from(owners);

  // A caret, or a range holding no text of its own (an image, an empty line).
  // The container is where the next character would be typed, so its style is
  // the one the fields are describing.
  const container = range.startContainer;
  const owner =
    container.nodeType === Node.ELEMENT_NODE
      ? (container as HTMLElement)
      : container.parentElement;
  return owner && element.contains(owner) ? [owner] : [element];
}

/**
 * Keeps the just-styled text selected.
 *
 * Rewriting `<font>` tags to spans discards the nodes the selection pointed
 * at, which would leave nothing to act on — picking a second font right after
 * the first would silently do nothing. Reselecting the replacement spans keeps
 * consecutive tweaks working, and matches how a slide tool keeps the selection
 * alive after formatting it.
 */
function reselect(doc: Document, spans: Element[]): void {
  if (spans.length === 0) return;
  const selection = doc.defaultView?.getSelection();
  if (!selection) return;
  const range = doc.createRange();
  range.setStartBefore(spans[0]);
  range.setEndAfter(spans[spans.length - 1]);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** The two commands that rewrite text into a list, or back out of one. */
const LIST_COMMANDS = new Set<string>(['insertUnorderedList', 'insertOrderedList']);

/** Whether the document is already writing CSS instead of legacy tags. */
function queryStyleWithCss(doc: Document): boolean {
  try {
    return doc.queryCommandState('styleWithCSS');
  } catch {
    // jsdom has no command state at all, and an engine that does not know the
    // name reports it as an error rather than as `false`. Either way the flag
    // gets put back down afterwards, which is the safe end to guess at.
    return false;
  }
}

function run(command: string, value?: string): void {
  const doc = getActiveStage()?.document;
  if (!doc || !session) return;

  if (!LIST_COMMANDS.has(command)) {
    withUndo(() => {
      if (!CSS_STYLED_COMMANDS.has(command)) {
        doc.execCommand(command, false, value);
        return;
      }
      // Read back rather than assumed to be off: the flag is document state, and
      // a document this editor did not open the session on could arrive with it
      // already raised.
      const styled = queryStyleWithCss(doc);
      doc.execCommand('styleWithCSS', false, 'true');
      doc.execCommand(command, false, value);
      if (!styled) doc.execCommand('styleWithCSS', false, 'false');
    });
    return;
  }

  // Some hosts cannot hold what the command would build — a `<ul>` that is
  // asked to unwrap itself, a `<span>` Blink refuses outright, a `<p>` whose
  // result does not survive being parsed back (core/editing/listHost.ts). Those
  // are rebuilt first, and the command then runs in a host that can take it.
  const host = sessionElement();
  const plan = host ? planListCommand(host.tagName, command) : 'direct';
  if (host && plan !== 'direct') {
    runOnRebuiltHost(plan, host, doc, command, value);
    return;
  }

  withUndo(() => buildList(doc, command, value));
}

/** The browser's own list command, plus the cleanups it always needs. */
function buildList(doc: Document, command: string, value?: string): void {
  const element = sessionElement();
  const before = element ? Array.from(element.querySelectorAll('span')) : [];
  const declared = element ? declarationsIn(element) : new Set<string>();
  // Which lists the box already had. `execCommand` does not say what it built,
  // so the ones this press is answerable for are the ones that were not here a
  // moment ago — and a deck's own list, sitting in the same box, is left with
  // whatever indent its author gave it.
  const lists = element ? listsIn(element) : new Set<Element>();
  doc.execCommand(command, false, value);
  dropPreservationSpans(new Set(before), declared);
  // The list arrives with no alignment of its own, and inheritance does not
  // survive the trip. Written here rather than as a command of
  // its own: inside the recording wrapper it is part of the markup difference
  // the commit records, so bulleting an aligned box stays one undo step.
  if (element) carryAlignmentIntoLists(element);
  // And it arrives outside its box: a marker positioned `outside` needs a
  // gutter the deck may have reset away, and the UA's `margin-block: 1em`
  // makes the list taller than its lines. Measured after the alignment, never
  // before — the left/justify branch of `listAlignmentStyle` clears
  // `padding-left`, so a gutter written first would be wiped out by it.
  if (element) fitListsIntoBox(element, lists);
}

/**
 * Rebuilds the editing host, then finishes the press on the element it became.
 *
 * Recorded as one {@link withHtmlSnapshot} rather than through {@link withUndo}:
 * the host element itself is replaced, and `SetInnerHtmlCommand` names an
 * element and rewrites what is *inside* it — an undo through that route would
 * put the old content back into the new tag and call it even. The slide-level
 * snapshot is the same one every other structural edit uses (actions.ts), so
 * the press stays a single step.
 *
 * `commitTextSession` runs first so that anything typed since the last step is
 * a step of its own. Without it the keystrokes would be inside the snapshot's
 * "before", and undoing the list would take the typing with it.
 */
function runOnRebuiltHost(
  plan: ListPlan,
  host: HTMLElement,
  doc: Document,
  command: string,
  value?: string,
): void {
  const stage = getActiveStage();
  if (!stage || !session) return;

  prepareSelection(host);
  commitTextSession();

  // Taken before the swap as plain values, never as the `Range` itself: moving
  // the children is enough to drag a live range's boundaries up to the box
  // (core/editing/listHost.ts). The text nodes come through, so the anchors do.
  const live = writableRange(host);
  const carried = live ? anchorsOf(live) : null;

  withHtmlSnapshot(t('command.editList'), () => {
    const rebuilt = rebuildListHost(plan, host, command);
    // The index still points at the element that was replaced, and everything
    // below resolves the session through it.
    stage.reindex();
    resumeSessionOn(rebuilt, carried);
    if (plan === 'rehost') buildList(doc, command, value);
  });

  // The snapshot recorded the markup; the baseline has to catch up to it, or
  // closing the session would record the same change a second time.
  baseline = sessionElement()?.innerHTML ?? '';
  snapshotSessionRange();
  refreshFormatState();
}

/**
 * Puts the caret back into the element the host became.
 *
 * A range that came through the swap still inside the box is restored as it
 * was, which is what keeps a second press acting on the same words. One that
 * did not — a range whose container was the element that went, which the DOM
 * lifts up to the slide root rather than deleting — is replaced by the whole of
 * the new host, which is the range the press was about anyway: the plans that
 * lose a range are the ones that rebuild the box as a whole.
 */
function resumeSessionOn(rebuilt: HTMLElement, carried: RangeAnchors | null): void {
  const selection = rebuilt.ownerDocument.defaultView?.getSelection();
  rebuilt.focus({ preventScroll: true });
  if (!selection) return;

  const range = rebuilt.ownerDocument.createRange();
  if (carried && anchorsRestorableIn(carried, rebuilt)) {
    range.setStart(carried.startContainer, carried.startOffset);
    range.setEnd(carried.endContainer, carried.endOffset);
  } else {
    range.selectNodeContents(rebuilt);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Undoes the styling a list command applies behind the user's back.
 *
 * A list is a structural change: it says whether text is a list, not how it
 * looks. Both engines disagree — taking a list off, they wrap what comes out in
 * a `<span style="font-size:26px">` holding the size it had *inside* the list,
 * so the text keeps the list's look forever after. In a deck styling `ul` at
 * 26px, a 44px heading turned into a bulleted line and back comes out 26px, and
 * the deck's own `h2` rule no longer reaches it. Pressing the button
 * twice has to leave the slide as it was.
 *
 * Two tests, because "the engine wrote it" alone is not enough: applying a list
 * can *rebuild* a span the user set, which arrives looking equally new. So a
 * span goes only if it did not exist before the command **and** declares
 * something the text was not already carrying — the rebuilt one restates a
 * declaration that was there, and stays. Anything with an attribute of its own
 * is the deck's and is never touched. The text nodes are moved rather than
 * rebuilt, so the caret rides along.
 */
function dropPreservationSpans(before: Set<Element>, declared: Set<string>): void {
  const element = sessionElement();
  if (!element) return;

  const doomed = Array.from(element.querySelectorAll('span')).filter(
    (span) =>
      !before.has(span) &&
      isBareSpan(span) &&
      !declarationsOf(span).every((declaration) => declared.has(declaration)),
  );
  if (doomed.length === 0) return;

  // A range anchored on one of these spans dies with it, which drops the caret
  // to the top of the element — and the next keystroke lands there. Positions
  // are therefore kept as character offsets, which survive any rearranging of
  // the nodes underneath them.
  const selected = selectedOffsets(element);
  for (const span of doomed) span.replaceWith(...Array.from(span.childNodes));
  if (selected) selectOffsets(element, selected);
}

interface TextRange {
  start: number;
  end: number;
}

/** Where the selection sits, counted in characters from the element's start. */
function selectedOffsets(element: HTMLElement): TextRange | null {
  const selection = element.ownerDocument.defaultView?.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!element.contains(range.commonAncestorContainer)) return null;

  const upToStart = element.ownerDocument.createRange();
  upToStart.selectNodeContents(element);
  upToStart.setEnd(range.startContainer, range.startOffset);
  const start = upToStart.toString().length;
  return { start, end: start + range.toString().length };
}

function selectOffsets(element: HTMLElement, offsets: TextRange): void {
  const doc = element.ownerDocument;
  const selection = doc.defaultView?.getSelection();
  if (!selection) return;

  const range = doc.createRange();
  range.selectNodeContents(element);
  range.collapse(false);

  const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let placedStart = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!placedStart && seen + length >= offsets.start) {
      range.setStart(node, offsets.start - seen);
      placedStart = true;
    }
    if (placedStart && seen + length >= offsets.end) {
      range.setEnd(node, offsets.end - seen);
      break;
    }
    seen += length;
  }

  selection.removeAllRanges();
  selection.addRange(range);
}

/** Every `property:value` the element's markup already carried, as strings. */
function declarationsIn(element: HTMLElement): Set<string> {
  const declarations = new Set<string>();
  for (const styled of Array.from(element.querySelectorAll('[style]'))) {
    for (const declaration of declarationsOf(styled)) declarations.add(declaration);
  }
  return declarations;
}

function declarationsOf(element: Element): string[] {
  const style = (element as HTMLElement).style;
  return Array.from({ length: style.length }, (_, index) => {
    const property = style.item(index);
    return `${property}:${style.getPropertyValue(property)}`;
  });
}

/** A span carrying nothing but styling: no class, no id, no hook of its own. */
function isBareSpan(span: Element): boolean {
  return Array.from(span.attributes).every(
    (attribute) => attribute.name === 'style' || attribute.name === UID_ATTRIBUTE,
  );
}

/**
 * Records the element's markup either side of the change. The edit is already
 * in the DOM by then, so the command is pushed without being re-applied — that
 * would rebuild the nodes and drop the caret.
 *
 * Whatever was typed beforehand is flushed first, so the two spans of editing
 * are recorded from where the history actually is rather than both from the
 * start of the session. (The engine may still merge the two into one step if
 * they land inside its merge window; how coarse a step is, is its call.)
 */
/**
 * True while one of this module's own commands is rewriting the text.
 *
 * The paste cleanup watches for nodes appearing in the element, and formatting
 * mints nodes too — `<b>`, the spans that carry a chosen size or family. Those
 * are the editor's own output and must survive untouched, so the watcher is
 * told to stand down for the duration.
 */
let formatting = false;

export function isFormatting(): boolean {
  return formatting;
}

function withUndo(mutate: () => void): void {
  const element = sessionElement();
  if (!session || !element) return;

  prepareSelection(element);
  commitTextSession();

  formatting = true;
  mutate();
  // Lowered in a microtask queued *after* the mutation, never before it: the
  // observer's own notification is queued during `mutate()`, and microtasks run
  // in order, so this one lands second and the watcher still sees the flag up.
  // Queuing it first — which is what this did at first — clears the flag before
  // the watcher looks, and the editor's own `<b>` and spans get scrubbed.
  queueMicrotask(() => {
    formatting = false;
  });

  // The command may have rebuilt the nodes under the old range; whatever it
  // left selected is the range the next command should act on.
  snapshotSessionRange();
  // Ahead of the next poll, so the button flips under the finger that pressed it.
  refreshFormatState();

  commitTextSession();
}
