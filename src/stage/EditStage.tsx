import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isRestoring, redo, setActiveStage, undo, useHistory } from '../core/commands/engine';
import { composeSlideDocument } from '../core/document/compose';
import type { SharedResources, Slide } from '../core/document/model';
import { useDocumentStore } from '../core/document/store';
import { editorEvents } from '../core/events/bus';
import { useSelectionStore } from '../core/selection/store';
import { matchesShortcut } from '../shared/shortcuts';
import {
  TEXT_TOOLS_ATTRIBUTE,
  commitTextSession,
  isFormatting,
  refreshFormatState,
  resyncTextBaseline,
  setTextSession,
  snapshotSessionRange,
} from '../core/editing/richText';
import { dropTrailingEmptyParagraphs, unwrapSoleParagraphs } from '../core/editing/paragraphs';
import { createInsertionCleaner } from '../core/editing/paste';
import { fillSelectionFromDrop, isFillable } from '../core/editing/imageFill';
import {
  dropTextBox,
  forgetTextBox,
  isBlank,
  isUntouchedTextBox,
  pendingTextBoxUid,
} from '../core/editing/textBox';
import {
  CROPPING_ATTRIBUTE,
  isCroppable,
  readPlacement,
  useCropSession,
} from '../core/editing/crop';
import { assetBaseUrl } from '../shared/assetBase';
import { backend } from '../shared/backend';
import { UID_ATTRIBUTE } from '../shared/ids';
import { StageBridge } from './bridge';
import { useStageContextMenu } from './contextMenuStore';
import { useSelectRequest } from './selectRequest';
import { useTextEditRequest } from './textEditRequest';
import { CropController, type CropGrip } from './cropGesture';
import { CropOverlay } from './CropOverlay';
import { boxOf, rotateVector, type OrientedBox } from './geometry';
import { GestureController, type Handle } from './interactions';
import { Overlay } from './Overlay';
import {
  BLANK_ATTRIBUTE,
  clearBlankMark,
  dropCaretLine,
  openCaretLine,
  placeholderRules,
  syncBlankMark,
} from './placeholder';
import {
  TextSelectionController,
  caretRangeAt,
  holdTextFocus,
  placeCaret,
} from './textSelection';
import { StageSurface } from './StageSurface';
import type { Guide } from './snapping';
import {
  ancestryOf,
  chooseSelectionTarget,
  describeElement,
  isTextEditable,
  selectionStack,
  siblingStep,
  stackStep,
  stepOutward,
} from './selectionHeuristics';
import type { GestureMeasure } from './measure';
import { t } from '../shared/i18n';

/**
 * How often the panel asks what is true at the caret. Moving the caret inside
 * the stage announces nothing — the document runs no scripts, so
 * `selectionchange` never crosses the boundary (ADR-0002) — and the only way to
 * keep the controls honest is to look.
 *
 * One tick answers for both halves of the panel, and deliberately in one place:
 * the on/off buttons (`useFormatState`, from `queryCommandState`) and the three
 * fields that carry a *value* — size, family, weight (`useCaretStyle`, from the
 * computed style of whatever owns the text under the caret). The fields used to
 * be seeded once per element and then sat still, so a heading with one word
 * blown up to 200px still read 200 with the caret back among the 64px text.
 * They ride this timer rather than growing one of their own, which is what
 * keeps "how often does the stage get poked" a single number.
 *
 * The second reader is close to free, so adding it did not buy a slower poll:
 * measured in the running app, `queryCaretStyle` is 0.006ms against the
 * 0.404ms the seven `queryCommandState` calls already cost — a caret samples
 * one element, and a range samples only the elements that own the text it
 * covers. Neither store is written unless the answer actually changed
 * (`refreshFormatState`), so five ticks a second re-render nothing while the
 * user types: measured, eight keystrokes and seven ticks published zero times.
 * That is what stops the poll from stepping on a half-typed value in a field.
 *
 * Only while a text session is open.
 */
const FORMAT_POLL_MS = 200;

interface EditStageProps {
  shared: SharedResources;
  slide: Slide | null;
  designWidth: number;
  designHeight: number;
  scale: number;
}

/**
 * The editable view of a slide.
 *
 * The document is loaded via `srcdoc` under `sandbox="allow-same-origin"` and
 * *without* `allow-scripts`, which is what makes editing tractable: the browser
 * guarantees none of the deck's JavaScript runs, so the DOM only changes when
 * the user changes it, while the host window keeps full access for editing
 * (docs/adr/0002-edit-preview-separation.md). CSS, including animations,
 * still applies in full.
 *
 * Pointer handling lives in a transparent layer over the frame rather than
 * inside it. One coordinate space, one place to reason about gestures, and the
 * deck's own links and controls can never swallow a click. The layer steps
 * aside only while text is being edited, so typing reaches the document.
 */
export function EditStage({ shared, slide, designWidth, designHeight, scale }: EditStageProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef<StageBridge | null>(null);
  const gesturesRef = useRef<GestureController | null>(null);
  const croppingRef = useRef<CropController | null>(null);
  /**
   * Where an Alt press landed, while it is still undecided whether it was a
   * click or the start of a duplicating drag. Null whenever Alt was not held.
   */
  const digRef = useRef<{ x: number; y: number; from: string | null } | null>(null);
  /** Lives as long as one text session; the host draws its selection (issues #17). */
  const textSelectionRef = useRef<TextSelectionController | null>(null);
  const lastSerialized = useRef<string | null>(null);
  const editing = useRef<{ uid: string } | null>(null);
  /**
   * Raised for as long as it takes the cleaner to hear about markup the
   * history just put back. See the subscription that raises it.
   */
  const restoringMarkup = useRef(false);

  const [reloadToken, setReloadToken] = useState(0);
  const [selectionBox, setSelectionBox] = useState<OrientedBox | null>(null);
  const [hoverBox, setHoverBox] = useState<OrientedBox | null>(null);
  const [focusBox, setFocusBox] = useState<OrientedBox | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  /** Live readout while a gesture runs; null the rest of the time. */
  const [measure, setMeasure] = useState<GestureMeasure | null>(null);
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [cropBoxes, setCropBoxes] = useState<{ frame: OrientedBox; picture: OrientedBox } | null>(
    null,
  );

  const setSlideHtml = useDocumentStore((s) => s.setSlideHtml);
  const selectedUid = useSelectionStore((s) => s.uid);
  const focusUid = useSelectionStore((s) => s.focusUid);
  const select = useSelectionStore((s) => s.select);
  const setAncestry = useSelectionStore((s) => s.setAncestry);
  const clearSelection = useSelectionStore((s) => s.clear);
  const cropTarget = useCropSession((s) => s.target);
  const startCrop = useCropSession((s) => s.start);
  const stopCrop = useCropSession((s) => s.stop);

  const slideId = slide?.id ?? null;

  const srcDoc = useMemo(() => {
    if (!slide) return '';
    return composeSlideDocument(shared, slide, { mode: 'edit', baseUrl: assetBaseUrl() });
    // Rebuilding on every html change would blow away the live DOM mid-edit;
    // reloads are driven by reloadToken instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared, slideId, reloadToken]);

  // An undo of a structural change rewrites html behind the stage's back.
  useEffect(() => {
    if (!slide) return;
    if (lastSerialized.current !== null && slide.html !== lastSerialized.current) {
      lastSerialized.current = slide.html;
      setReloadToken((t) => t + 1);
    }
  }, [slide]);

  useEffect(() => {
    // Before `clearSelection()` below, and deliberately `forget` rather than
    // `drop`: by the time this effect runs React has already swapped the frame
    // out, so the stage a drop would reach for is no longer the one the box
    // lives in — reverting the insertion through it would write the old slide's
    // markup into the new slide. The box is actually taken back a beat earlier,
    // by the `slide:changed` listener further down, while the old stage is
    // still live. This is only the backstop that stops the *record* from
    // following the user to the next slide, where the next thing to touch it
    // would be aiming at a uid that means something else.
    forgetTextBox();
    lastSerialized.current = null;
    editing.current = null;
    setEditingUid(null);
    stopCrop();
    clearSelection();
    // The hover frame is otherwise only cleared by the pointer leaving the
    // stage, so paging with ← → or the thumbnails while the pointer rests on
    // the canvas left a frame drawn at the old slide's coordinates.
    setHoverBox(null);
  }, [slideId, clearSelection, stopCrop]);

  /* ------------------------------------------------------------- overlay */

  const refreshOverlay = useCallback(() => {
    const bridge = bridgeRef.current;
    if (!bridge) return;

    const uid = useSelectionStore.getState().uid;
    const selected = uid ? (bridge.resolve(uid) as HTMLElement | null) : null;
    setSelectionBox(selected ? boxOf(selected) : null);

    // The breadcrumb preview. Skipped for the selected element itself, where a
    // second frame on the same box would only read as a rendering glitch.
    const focused = useSelectionStore.getState().focusUid;
    const target =
      focused && focused !== uid ? (bridge.resolve(focused) as HTMLElement | null) : null;
    setFocusBox(target ? boxOf(target) : null);

    setCropBoxes(measureCrop(bridge, useCropSession.getState().target));
  }, []);

  useEffect(refreshOverlay, [cropTarget, refreshOverlay]);

  useEffect(refreshOverlay, [selectedUid, focusUid, refreshOverlay]);

  useEffect(refreshOverlay, [editingUid, refreshOverlay]);

  const commit = useCallback(() => {
    const bridge = bridgeRef.current;
    if (!bridge || !slideId) return;
    const html = bridge.serializeSlide();
    lastSerialized.current = html;
    setSlideHtml(slideId, html);
    refreshOverlay();
  }, [slideId, setSlideHtml, refreshOverlay]);

  /* --------------------------------------------------------- text editing */

  const finishTextEditing = useCallback(() => {
    const bridge = bridgeRef.current;
    const session = editing.current;
    editing.current = null;
    textSelectionRef.current = null;
    setEditingUid(null);
    if (!bridge || !session) return;

    const element = bridge.resolve(session.uid) as HTMLElement | null;
    // Whether this session is leaving the freshly inserted box exactly as it
    // found it: still the pending one, still without a word in it. Decided
    // before anything else, because leaving an empty `contenteditable` can mint
    // a stray `<br>`, and that must not go on the stack as the user having
    // written something.
    //
    // Ending a session like that used to *drop* the box (`dropTextBox`), which
    // made Escape destructive in a way no other Escape in the editor is:
    // double-click an empty box to type in it, change your mind, and the box
    // itself was gone. Escape now means here what it means everywhere else —
    // step out of the object, back to having it selected — and taking an unused
    // box back is left entirely to the signals that say the user has moved on:
    // the selection leaving it, the slide changing, the mode changing. Ending a
    // session is none of those; the user is still standing on the box.
    const untouched = element !== null && isUntouchedTextBox(session.uid, element);

    // The line the caret stood on goes back out before anything measures the
    // markup (placeholder.ts). It was scaffolding for the session, so it must
    // not be in what the commit below records, or in what serialization reads
    // afterwards — and it only comes out while the element is still blank, so a
    // user who typed keeps whatever break the browser made of it.
    if (element) dropCaretLine(element);

    // And the wrapper the browser put round the words goes with it. Pressing
    // Return in a `contenteditable` mints a `<div>` and there is no way to stop
    // it: the frame runs no scripts, so the key is never seen (ADR-0002), and
    // `defaultParagraphSeparator` only chooses which tag. So the shape is put
    // right once, here, where the session is over and no caret can be standing
    // in what moves (core/editing/paragraphs.ts).
    if (element && !untouched) {
      // The empty line Return left at the end goes first: clearing it is what
      // can leave a single wrapper for the unwrap below to take off.
      dropTrailingEmptyParagraphs(element);
      unwrapSoleParagraphs(element);
    }

    // Typing leaves no command behind, so the last of it is recorded here,
    // measured from wherever the history had already got to — which is what the
    // formatting commands moved forward as they ran.
    if (!untouched) commitTextSession();
    setTextSession(null);

    if (!element) {
      // Nothing left to point at, so the record can only mislead whoever reads
      // it next — and there is nothing to drop either.
      forgetTextBox();
      return;
    }
    element.removeAttribute('contenteditable');
    element.removeAttribute('spellcheck');

    if (untouched) {
      // The record is *kept*, and that is the whole of why this branch exists.
      // It is what lets the box be entered again — all three doors into a
      // session ask `isUntouchedTextBox` — and forgetting it here would spend
      // that on the first visit: enter the box, type nothing, leave, and it
      // could never be typed into again while still being invisible. It is also
      // what the drop signals watch, so keeping it is what still stops an
      // unused box from quietly piling up on the slide.
      //
      // The prompt is put back rather than taken off. While the session was open
      // the mark was kept in step by that session's mutation observer, which is
      // gone by now; the effect that paints a merely-selected box will not run
      // again either, because the selection has not moved. So the last word on
      // it is here (placeholder.ts owns what the mark means).
      syncBlankMark(element);
    } else {
      // The same for a box that was already on the slide: if the session leaves
      // it with nothing in it, the mark stays on.
      //
      // It used to come off here, and that is what made emptying a box a
      // one-way door (issues #104). Without the mark the element is a deck's
      // empty `<div>` again by every test the editor has — `isTextEditable`
      // refuses it, so no double-click, Enter or F2 can open it again;
      // `isSelfContained` refuses it, so a click selects the panel behind it;
      // and the CSS floor that gives it somewhere to be clicked stops applying,
      // which on this deck took 122 of 262 text elements to zero width. The
      // mark is what says "the editor knows this one is text", and that is
      // still true of a box the user has just emptied.
      //
      // `syncBlankMark` rather than setting it: a session that ends with words
      // in the box must take the mark *off*, and that is the same call.
      syncBlankMark(element);
      forgetTextBox();
    }

    releaseTextFocus(element, layerRef.current);
    // And the object is left selected. Nothing normally moves the selection
    // during a session, so this is usually a no-op; it is written down because
    // for an empty box the frame and its handles are now the *only* thing
    // saying where the box is, and "Escape leaves you holding the object" has
    // to hold even if some future exit forgets to keep the selection with it.
    if (useSelectionStore.getState().uid !== session.uid) select(session.uid);
    refreshOverlay();
  }, [refreshOverlay, select]);

  const startTextEditing = useCallback((uid: string, at?: { x: number; y: number }) => {
    const bridge = bridgeRef.current;
    const element = bridge?.resolve(uid) as HTMLElement | null;
    if (!element) return;
    editing.current = { uid };
    setTextSession({ uid });
    setEditingUid(uid);
    element.setAttribute('contenteditable', 'true');
    element.setAttribute('spellcheck', 'false');

    // An element with nothing in it has no line box, and a caret with no line
    // box is not painted — focus or no focus (placeholder.ts has the
    // measurement). So it is given one before it is focused. Not through a
    // command: this is session scaffolding of the same kind as the
    // `contenteditable` attribute two lines up — put in as the session opens,
    // taken back as it closes, and never a description of what the user wrote
    // (ADR-0003 is about edits, and no edit has happened yet).
    const blank = isBlank(element);
    if (blank) openCaretLine(element);
    syncBlankMark(element);
    // Not `element.focus()` on its own. A caret is only painted for the focused
    // element *of the focused frame*, and the press that got us here left the
    // host's focus on `.stage-interaction` (`handleLayerPointerDown`). Chromium
    // moves the host's focus to the frame as a side effect of focusing
    // something inside it, so the one call was enough there and nowhere else;
    // `holdTextFocus` walks the whole way in (textSelection.ts).
    holdTextFocus(element);

    if (blank) {
      // The caret has to stand *before* that break. `placeCaret` collapses to
      // the end of the element, which with one `<br>` inside means offset 1 —
      // the second line — and the first character typed there would leave the
      // break sitting in front of it. The double-click point goes the same way:
      // an element with nothing in it has exactly one caret position, so
      // wherever the pointer landed, it landed on empty space.
      const selection = element.ownerDocument.defaultView?.getSelection();
      const range = element.ownerDocument.createRange();
      range.setStart(element, 0);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
    } else {
      placeCaret(element, at);
    }

    // One controller per session, so the press-count run (single / word / whole
    // element) survives from one press to the next.
    const doc = element.ownerDocument;
    textSelectionRef.current = new TextSelectionController(element, (x, y) =>
      caretRangeAt(doc, x, y),
    );
  }, []);

  /* --------------------------------------------- the box just inserted */

  /*
   * An inserted text box is empty, and an empty box is invisible. It lands
   * selected rather than open for typing (core/editing/textBox.ts), so what
   * says "there is a box here" is the selection frame, its handles, and the
   * prompt below.
   *
   * What stops an unused one from silently piling up on the slide is the user
   * moving on, and that is three signals and no others: the selection leaving
   * the box, the slide changing under it, the editor leaving edit mode. Ending
   * a text session is deliberately not among them — see `finishTextEditing`,
   * where Escape used to take the box with it. The three effects here are those
   * jobs: take it back when the selection goes, paint it while it stays, and
   * take it back on the way out of the slide or out of the mode.
   */

  /**
   * The selection leaving the freshly inserted box takes the insertion back.
   *
   * A subscription rather than an effect on `selectedUid`, because the record
   * has to be read *while* the selection moves, not a render later. Inserting
   * two boxes in a row is the case that decides it: the second insertion
   * selects its own box, and by the time an effect ran the record would already
   * name the second one — the first box would never be looked at again and
   * would stay on the slide, empty and unselectable.
   *
   * Undo and redo are the exception, and have to be. Restoring a slide's markup
   * restores the selection with it (commands/snapshot.ts), so undoing the
   * insertion arrives here looking exactly like the user having clicked
   * elsewhere — but the box is not being abandoned, it is being taken back by
   * the history, and the history will want to hand it over again on redo.
   * Treating it as abandonment cost the redo: the record was cleared, so the box
   * came back as a nameless empty `<div>` that could not be typed into and, an
   * empty box painting nothing, could not be seen either. Skipping leaves the
   * record naming a uid that is momentarily not in the document, which costs
   * nothing — the next real selection change drops it, and by then `revoke`
   * refuses (the step is on the redo stack) and there is no element to remove.
   */
  useEffect(() => {
    return useSelectionStore.subscribe((state) => {
      if (isRestoring()) return;
      const uid = pendingTextBoxUid();
      if (!uid || uid === state.uid) return;

      // Where the user is going, taken before anything can move it. Revoking
      // the insertion restores the selection to what it was *before* the box
      // existed — which is right for an undo, and is the same code path
      // (HtmlSnapshotCommand.revert) — but here it would undo the very click
      // that brought us in. So the destination is put back afterwards.
      const wanted = state.uid;
      dropTextBox(uid);
      const selection = useSelectionStore.getState();
      if (selection.uid === wanted) return;
      if (wanted) selection.select(wanted);
      else selection.clear();
    });
  }, []);

  /**
   * The prompt, on the box while it is only selected.
   *
   * The mark is what the injected CSS paints on (stage/placeholder.ts), and it
   * goes on this one element only. The obvious wider rule — mark whatever empty
   * element is selected — would put 「テキストを入力」 on the empty `<div>`s a
   * deck uses for panels and rules the moment one is clicked.
   */
  useEffect(() => {
    const uid = pendingTextBoxUid();
    if (!uid || uid !== selectedUid) return;
    const element = bridgeRef.current?.resolve(uid);
    if (!element) return;
    syncBlankMark(element);
    // Normally the element is gone by the time this runs — the selection moving
    // away is what removes it. It matters when the drop could not happen, so a
    // box that outlived its record does not keep wearing the prompt.
    return () => clearBlankMark(element);
  }, [selectedUid]);

  /**
   * Leaving the slide, or leaving edit mode, takes an unused box back with it.
   *
   * On the events rather than on `slideId` and `mode`, and this is the only
   * place that difference is load-bearing. `uiStore` emits both synchronously,
   * inside `setSlideIndex` / `setMode` and immediately after the `set()` — so
   * they arrive before React has re-rendered, while this stage still holds the
   * slide the box is on and `getActiveStage()` still answers with the bridge
   * the revert has to go through.
   *
   * Neither React hook can stand in for that. The `[slideId]` effect runs after
   * the frame has already been replaced, where reverting the insertion would
   * write the old slide's markup into the new one — see the `forgetTextBox()`
   * there. And switching to preview does not re-render this component at all:
   * `App` swaps `EditStage` for `PreviewStage`, so the only hook left is an
   * unmount cleanup, by which time the stage is gone and the drop would find
   * nothing to work on. Without this listener the empty `<div>` simply stayed
   * on the slide and rode into ⌘S and the export — which is invariant 2, the
   * one thing the editor may never do to a deck.
   *
   * The mode is not looked at: this listener only exists while the edit stage
   * is mounted, so the only change it can hear is the one out of edit mode.
   */
  useEffect(() => {
    const dropPending = () => {
      const uid = pendingTextBoxUid();
      if (uid) dropTextBox(uid);
    };
    const offSlide = editorEvents.on('slide:changed', dropPending);
    const offMode = editorEvents.on('mode:changed', dropPending);
    return () => {
      offSlide();
      offMode();
    };
  }, []);

  /* ------------------------------------------------------------ selection */

  const selectElement = useCallback(
    (element: Element) => {
      const bridge = bridgeRef.current;
      if (!bridge) return;
      const uid = bridge.uidOf(element);
      if (!uid) return;

      select(uid);
      setAncestry(
        ancestryOf(element).map((el) => ({
          uid: bridge.uidOf(el) ?? '',
          label: describeElement(el),
        })),
      );
    },
    [select, setAncestry],
  );

  /* -------------------------------------------------------------- gestures */

  const handleCropGripDown = useCallback(
    (grip: CropGrip, event: React.PointerEvent) => {
      const cropping = croppingRef.current;
      const layer = layerRef.current;
      const target = useCropSession.getState().target;
      if (!cropping || !layer || !target) return;
      const point = pointInLayer(layer, event);
      layer.setPointerCapture(event.pointerId);
      cropping.begin(point.x, point.y, target, grip, scale);
    },
    [scale],
  );

  /**
   * Selecting the next thing back in the pile under a point.
   *
   * The point is in the stage's own coordinates, the same ones `elementsAt`
   * wants. `from` is where the step starts — not the selection as it stands,
   * because the press that asked for this already moved that to the front of
   * the pile so a drag would have something to work on. Reading it here would
   * make every Alt+click return the same second element; reading what was
   * selected *before* the press walks the pile one layer per click and wraps
   * at the end (stage/selectionHeuristics.ts).
   */
  const selectBehind = useCallback(
    (x: number, y: number, from: string | null) => {
      const bridge = bridgeRef.current;
      if (!bridge) return;
      const stack = selectionStack(bridge.elementsAt(x, y));
      const next = stackStep(stack, from ? bridge.resolve(from) : null);
      if (next) selectElement(next);
      else clearSelection();
    },
    [selectElement, clearSelection],
  );

  const handleLayerPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const bridge = bridgeRef.current;
      const gestures = gesturesRef.current;
      if (!bridge || !gestures) return;
      // Only the primary button drags. A right-click is asking for the context
      // menu, and starting a move on it would drag the element out from under
      // the menu it just opened.
      if (event.button !== 0) return;

      // The browser's own answer to a press here is never the one the user
      // asked for: it starts a text selection, and a press that lands on text
      // already selected starts a *native drag* of that selection instead —
      // which arrives as `pointercancel` and takes the gesture with it. That is
      // candidate (a) of issues #16 and the whole of #17, and it is the same
      // chain `.pane-divider` was caught in (#8). `user-select: none` on the
      // layer suppresses it too; both are kept because they fail differently
      // (a lost stylesheet, or a handler that stops running).
      event.preventDefault();
      // Which `preventDefault` costs us: the press no longer moves focus here
      // by itself, and the key handler below listens on the window but Escape
      // and the arrow keys still have to not be swallowed by the frame.
      layerRef.current?.focus({ preventScroll: true });

      const x = event.nativeEvent.offsetX;
      const y = event.nativeEvent.offsetY;
      layerRef.current?.setPointerCapture(event.pointerId);

      // Alt asks for what is *behind* the thing under the pointer (issues
      // #102), but only if the press stays a press: held through a drag it
      // already means "leave a copy", and that has to keep starting from what
      // the user can see. Which it is only becomes true on release, so the
      // point is parked here — together with the selection as it stands, taken
      // before the lines below move it to the front of the pile — and read by
      // `handleLayerPointerUp`.
      digRef.current = event.altKey
        ? { x, y, from: useSelectionStore.getState().uid }
        : null;

      const hit = bridge.elementAt(x, y);
      const target = hit && bridge.isInsideSlide(hit) ? chooseSelectionTarget(hit) : null;

      if (!target) {
        clearSelection();
        return;
      }

      const uid = bridge.uidOf(target);
      if (!uid) return;

      if (useSelectionStore.getState().uid !== uid) selectElement(target);
      // The zoom goes with it, here and on the handles below: a gesture works
      // in stage pixels, so its dead zone has to be converted from the screen
      // the hand is shaking on.
      gestures.beginMove(x, y, uid, scale);
    },
    [clearSelection, selectElement, scale],
  );

  /**
   * Right-click selects what is under the pointer and offers the menu for it.
   *
   * Not while text is being edited: the interaction layer steps aside then, so
   * the click lands in the frame — and WebKit runs no listeners in a document
   * with scripting disabled, leaving nothing able to call `preventDefault()`.
   * A menu that cannot suppress the browser's own is worse than none, so the
   * platform keeps that case.
   */
  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    const bridge = bridgeRef.current;
    const layer = layerRef.current;
    if (!bridge || !layer || editing.current) return;
    event.preventDefault();

    const { x, y } = pointInLayer(layer, event);
    const hit = bridge.elementAt(x, y);
    const target = hit && bridge.isInsideSlide(hit) ? chooseSelectionTarget(hit) : null;
    const uid = target ? bridge.uidOf(target) : null;

    if (uid) {
      if (useSelectionStore.getState().uid !== uid) selectElement(target as HTMLElement);
    } else {
      clearSelection();
    }

    // The pile Alt+click walks, listed where it can be found: someone who
    // cannot reach a box right-clicks whatever is covering it, which is this
    // point exactly. Named rather than stepped through — see the store.
    const stack = selectionStack(bridge.elementsAt(x, y))
      .map((element) => ({ uid: bridge.uidOf(element) ?? '', label: describeElement(element) }))
      .filter((entry) => entry.uid !== '');

    useStageContextMenu.getState().open({
      at: { x: event.clientX, y: event.clientY },
      uid,
      stack,
      croppable: target !== null && isCroppable(target),
      // 「画像を入れる」 wherever a box can hold one, with no test ordered in
      // front of it. A double-click had to put `textual` first because one
      // gesture cannot mean two things (decisions #100); a menu is read before
      // it is used, so the freshly inserted text box can simply offer both
      // rows and let the user say which one was meant.
      fillable: target !== null && isFillable(target),
      // 「テキストを編集」 is offered on the freshly inserted box too, on the
      // same terms as the other two doors into a session
      // (`handleLayerDoubleClick` carries the reasoning).
      textEditable:
        target !== null &&
        (isTextEditable(target) || (uid !== null && isUntouchedTextBox(uid, target))),
    });
  }, [clearSelection, selectElement]);

  const handleLayerPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const bridge = bridgeRef.current;
    const gestures = gesturesRef.current;
    if (!bridge || !gestures) return;

    const x = event.nativeEvent.offsetX;
    const y = event.nativeEvent.offsetY;

    if (croppingRef.current?.active) {
      croppingRef.current.move(x, y);
      return;
    }

    if (gestures.active) {
      gestures.move(x, y, { shift: event.shiftKey, alt: event.altKey });
      return;
    }

    const hit = bridge.elementAt(x, y);
    const target = hit && bridge.isInsideSlide(hit) ? chooseSelectionTarget(hit) : null;
    setHoverBox(target ? boxOf(target as HTMLElement) : null);
  }, []);

  const handleLayerPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      layerRef.current?.releasePointerCapture(event.pointerId);
      // Read before `end()`, which drops the gesture that knows the answer.
      const dragged = gesturesRef.current?.moved ?? false;
      const dig = digRef.current;
      digRef.current = null;
      croppingRef.current?.end();
      gesturesRef.current?.end();
      commit();
      // A drag was the other meaning of Alt and has already had it. Nothing is
      // said about a crop session: its grips have their own handler, so a press
      // that set `digRef` was one on the interaction layer either way.
      if (dig && !dragged) selectBehind(dig.x, dig.y, dig.from);
    },
    [commit, selectBehind],
  );

  /**
   * A cancelled gesture is not a finished one.
   *
   * Plenty of things cancel a pointer without the user letting go: the browser
   * deciding to drag a selection natively, a Windows touchpad reclassifying the
   * movement as a system gesture, the capture being taken away. This used to
   * run the pointer-up path, which *committed* whatever few pixels the drag had
   * covered — and that is exactly what the Windows build shows as "the object
   * jumps a little and then stops" (issues #16). Rewinding says the true thing
   * instead: the gesture failed, so nothing moved.
   *
   * The same reasoning Escape already uses (see the key handler below); this
   * only gives the other way a gesture can die the same ending.
   */
  const handleLayerPointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      layerRef.current?.releasePointerCapture(event.pointerId);
      // A press that was taken away never became a click either.
      digRef.current = null;
      // Both are safe with no gesture running, so neither needs an `active` test.
      croppingRef.current?.cancel();
      gesturesRef.current?.cancel();
      // The gesture wrote to the stage as it went; put the store back in step
      // with the DOM that was just restored.
      commit();
    },
    [commit],
  );

  /**
   * The box a file being dragged over the window would land in, or null.
   *
   * The point arrives in viewport pixels (shared/backend.ts), while the layer
   * is drawn at design size and scaled by its parent — so the rect is
   * post-scale and the document's own coordinates are what `elementAt` wants.
   * Dividing by `scale` is what crosses between them; the same trip a pointer
   * event makes for free through `offsetX`.
   */
  const dropTargetAt = useCallback(
    (x: number, y: number): { uid: string; element: HTMLElement } | null => {
      const bridge = bridgeRef.current;
      const layer = layerRef.current;
      // A drop mid-session would put a picture into a box the user is typing
      // in, with the caret still blinking in it. There is no reading of that
      // gesture worth guessing at.
      if (!bridge || !layer || editing.current) return null;

      const rect = layer.getBoundingClientRect();
      const localX = (x - rect.left) / scale;
      const localY = (y - rect.top) / scale;
      if (localX < 0 || localY < 0 || localX * scale > rect.width || localY * scale > rect.height) {
        return null;
      }

      const hit = bridge.elementAt(localX, localY);
      if (!hit || !bridge.isInsideSlide(hit)) return null;
      const target = chooseSelectionTarget(hit);
      if (!target || !isFillable(target)) return null;
      const uid = bridge.uidOf(target);
      return uid ? { uid, element: target as HTMLElement } : null;
    },
    [scale],
  );

  /**
   * Dropping an image file onto a box that can hold one.
   *
   * Not the HTML5 `drop` event — Tauri takes the drag before the WebView sees
   * it, so this arrives as an event from the backend instead
   * (shared/backend.ts). The consequence for this component is that the drag
   * is invisible to CSS: `:hover` never fires, no element gets a drag class,
   * and the only way to say "it will land here" is to draw it.
   *
   * The hover frame is what draws it. It already means "the pointer is over
   * this", it is drawn host-side like every other overlay (invariant 15), and
   * a drag cannot collide with a real hover because the OS is holding the
   * pointer for the duration of one.
   */
  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;

    void backend
      .onFileDrag((event) => {
        if (event.kind === 'leave') {
          setHoverBox(null);
          return;
        }
        const target = dropTargetAt(event.x, event.y);
        setHoverBox(target ? boxOf(target.element) : null);
        if (event.kind !== 'drop') return;

        setHoverBox(null);
        if (!target) return;
        // Selected first, the way the double-click does it: the box a picture
        // landed in is the one the user goes on working with, and
        // `fillWithImage` reads the selection rather than taking a uid.
        select(target.uid);
        void fillSelectionFromDrop(event.paths);
      })
      .then((fn) => {
        // The subscription is async and this effect can be torn down before it
        // resolves — a slide change is enough. Without this the listener would
        // outlive the stage that owns the bridge it reads.
        if (cancelled) fn();
        else stop = fn;
      });

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [dropTargetAt, select]);

  const handleLayerDoubleClick = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const bridge = bridgeRef.current;
      if (!bridge) return;
      const x = event.nativeEvent.offsetX;
      const y = event.nativeEvent.offsetY;
      const hit = bridge.elementAt(x, y);
      if (!hit || !bridge.isInsideSlide(hit)) return;
      const target = chooseSelectionTarget(hit);
      if (!target) return;
      // A picture has no text to enter, and trimming is the thing a second
      // click on one is asking for — the same gesture Keynote and Figma use.
      if (isCroppable(target)) {
        const uid = bridge.uidOf(target);
        if (uid) {
          select(uid);
          startCrop();
        }
        return;
      }
      const uid = bridge.uidOf(target);
      if (uid === null) return;
      // `isTextEditable` asks whether an element has text of its own, so it says
      // no to the box inserted a moment ago — the one element on the slide the
      // user most obviously means to type into. The exception is made at the
      // door rather than inside that function: it is the same rule that decides
      // what counts as background, and loosening it there would make every
      // empty `<div>` in a deck editable and selectable (decisions #52, #75).
      // `isUntouchedTextBox` answers for exactly one element and only until
      // something is typed into it (core/editing/textBox.ts).
      const textual = isTextEditable(target) || isUntouchedTextBox(uid, target);
      // No 画像を入れる here any more. A second click on a box holding neither
      // words nor a picture used to open the file dialog, which meant the
      // gesture's meaning depended on what the box happened to contain — and
      // an empty box is exactly the case the user cannot tell apart by looking.
      // The operation moved to the right-click menu, where the row carries its
      // own name (features/StageContextMenu.tsx).
      if (!textual) return;
      startTextEditing(uid, { x, y });
    },
    [startTextEditing, select, startCrop],
  );

  const handleHandleDown = useCallback((handle: Handle, event: React.PointerEvent) => {
    const gestures = gesturesRef.current;
    const layer = layerRef.current;
    if (!gestures || !layer) return;
    const uid = useSelectionStore.getState().uid;
    if (!uid) return;
    const point = pointInLayer(layer, event);
    layer.setPointerCapture(event.pointerId);
    gestures.beginResize(point.x, point.y, uid, handle, scale);
  }, [scale]);

  /**
   * A press on the selection frame's edge: move what is selected, whatever the
   * pointer would otherwise have landed on. The same shape as
   * `handleHandleDown` — the frame is host chrome, so this is the one route to
   * an element a hit test cannot name (Overlay.tsx).
   */
  const handleFrameDown = useCallback((event: React.PointerEvent) => {
    const gestures = gesturesRef.current;
    const layer = layerRef.current;
    if (!gestures || !layer) return;
    const uid = useSelectionStore.getState().uid;
    if (!uid) return;
    const point = pointInLayer(layer, event);
    layer.setPointerCapture(event.pointerId);
    gestures.beginMove(point.x, point.y, uid, scale);
  }, [scale]);

  const handleRotateDown = useCallback((event: React.PointerEvent) => {
    const gestures = gesturesRef.current;
    const layer = layerRef.current;
    if (!gestures || !layer) return;
    const uid = useSelectionStore.getState().uid;
    if (!uid) return;
    const point = pointInLayer(layer, event);
    layer.setPointerCapture(event.pointerId);
    gestures.beginRotate(point.x, point.y, uid, scale);
  }, [scale]);

  /**
   * A click on the shields: the parts of the stage outside the element being
   * edited. Host elements, because a scripting-disabled frame document never
   * fires listeners in WebKit — this is the only click-inside-the-stage exit
   * that works in the real app. Ends the session and selects what was under
   * the pointer, so one click does what it does everywhere else.
   */
  const handleShieldDown = useCallback(
    (event: React.PointerEvent) => {
      const bridge = bridgeRef.current;
      const layer = layerRef.current;
      finishTextEditing();
      if (!bridge || !layer) return;

      const point = pointInLayer(layer, event);
      const hit = bridge.elementAt(point.x, point.y);
      const target = hit && bridge.isInsideSlide(hit) ? chooseSelectionTarget(hit) : null;
      if (target) selectElement(target);
      else clearSelection();
    },
    [finishTextEditing, selectElement, clearSelection],
  );

  /**
   * A press on the text being edited. The frame never sees it — which is the
   * point: left to the browser, a press inside an existing range starts a
   * native drag of that range instead of a new selection, and a
   * scripting-disabled document gives the host nothing to call
   * `preventDefault()` on (issues #17). The selection is built here instead.
   */
  const handleTextDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const selecting = textSelectionRef.current;
    const layer = layerRef.current;
    const bridge = bridgeRef.current;
    const session = editing.current;
    if (!selecting || !layer || !bridge || !session || event.button !== 0) return;

    // Same pair as the interaction layer (see handleLayerPointerDown): without
    // it the host starts a selection of its own chrome, and focus leaves the
    // frame — which would stop typing dead.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const { x, y } = pointInLayer(layer, event);
    selecting.begin(x, y, { at: event.timeStamp, shift: event.shiftKey });

    // The caret only shows, and typing only lands, while the frame's element
    // holds focus. Nothing took it away here, but a press is also how focus
    // comes back after the inspector borrowed it — and the shield this press
    // landed on is host chrome, so the host's own focus has to be handed back
    // over the frame boundary as well, not just inside it.
    const focused = bridge.resolve(session.uid) as HTMLElement | null;
    if (focused) holdTextFocus(focused);
    refreshFormatState();
  }, []);

  const handleTextMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const selecting = textSelectionRef.current;
    const layer = layerRef.current;
    if (!selecting?.dragging || !layer) return;
    const { x, y } = pointInLayer(layer, event);
    selecting.extendTo(x, y);
  }, []);

  const handleTextUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    textSelectionRef.current?.end();
    // The panel is on a 200ms timer; asking now keeps the buttons *and* the
    // size / font / weight fields from lagging a fifth of a second behind the
    // selection the user just made — which is the one moment the lag is
    // legible, because the user is looking straight at what they selected.
    refreshFormatState();
  }, []);

  // Typing reflows the element, and no event says so (the frame's DOM fires
  // nothing here). Mutation records still work across the boundary, so the
  // overlay — and with it the text shield — tracks the text as it grows.
  useEffect(() => {
    if (!editingUid) return;
    const element = bridgeRef.current?.resolve(editingUid);
    if (!element) return;

    // What this box already declares, so that a node turning up in it can be
    // judged against it. It has to be built here, as the session opens, and
    // kept for the whole of it: the judgement is "did the browser copy this
    // from something already in the box", and by the time a record arrives the
    // copy is in the tree looking exactly like its source
    // (core/editing/paste.ts holds the reasoning and the rejected alternatives).
    const cleaner = createInsertionCleaner(element);

    let queued = 0;
    const observer = new MutationObserver((records) => {
      // Whatever a paste dropped in is cleaned here rather than in a `paste`
      // listener, which the scripting-disabled frame would never fire
      // (core/editing/paste.ts). Stood down while the editor's own formatting
      // is running, since that mints nodes of its own that must survive — but
      // stood down by *telling* the cleaner rather than by skipping it, because
      // what those commands minted is markup the box now has, and the next
      // thing the browser copies out of it has to be allowed to keep it.
      //
      // An undo stands it down for the same reason and was not doing so:
      // restoring a snapshot replaces the element's children, every one of
      // which arrives as an *added node*, so undoing inside a session ran the
      // whole restored subtree through the paste cleaner — measured, it came
      // back stripped of `data-hse-uid` (invariant 6) and of any declaration
      // the box no longer happened to be carrying. Markup this editor recorded
      // itself is the last thing that should be treated as arriving from a
      // foreign application.
      if (isFormatting() || restoringMarkup.current) cleaner.accept();
      else cleaner.clean(records);
      // The prompt has to follow what is in the element, not just how it
      // started: it goes on the first keystroke and comes back when the last
      // character is deleted. Attributes are not observed, so writing the mark
      // here cannot bring the observer round again (placeholder.ts).
      syncBlankMark(element);
      cancelAnimationFrame(queued);
      queued = requestAnimationFrame(() => {
        readdressUnknownElements(element, bridgeRef.current);
        refreshOverlay();
      });
    });
    observer.observe(element, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(queued);
    };
  }, [editingUid, refreshOverlay]);

  /* ----------------------------------------------------------------- load */

  const handleLoad = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc || !slideId) return;

    injectEditorStyles(doc);
    const bridge = new StageBridge(doc, commit);
    bridgeRef.current = bridge;
    setActiveStage(bridge);
    lastSerialized.current = bridge.serializeSlide();

    gesturesRef.current = new GestureController(bridge, {
      onGuides: setGuides,
      onChange: refreshOverlay,
      onMeasure: setMeasure,
    });
    croppingRef.current = new CropController(bridge, refreshOverlay);

    // WebKit refuses to run listeners in a scripting-disabled document, so
    // nothing attached to the frame's DOM can be trusted to fire in the real
    // app — ending a session on clicks inside the stage is the overlay
    // shields' job (host elements; see Overlay). This listener is a Chromium
    // extra: it catches Escape while the caret is in the frame, which no host
    // listener can see.
    //
    // ⌘Z is here for the same reason and is not an extra at all. A keydown
    // inside the frame never reaches the host window, so `App`'s `edit.undo`
    // handler — the owner of the key, per shared/shortcuts — simply does not
    // run while the caret is in the text: measured, the app's undo stack did
    // not move while the DOM went back a step on its own, because the engine
    // had taken the key for its *own* undo — and pressing 元に戻す afterwards
    // put up markup that did not match what was on screen. Two histories on one
    // keypress, and the
    // one the toolbar shows is the one that loses. `preventDefault` is what
    // takes the key off the engine; the app's history then answers it, which is
    // the only history the user has been shown.
    //
    // Redo is asked first: `edit.undo` names no Shift and a stroke's unnamed
    // modifiers must be absent, so the two cannot both match — the order is for
    // the reader, and matches `App`'s.
    //
    // None of this reaches WebKit. `readdressUnknownElements` is what stands in
    // there, and it holds a strictly smaller line: not "the right history wins"
    // but "nothing the wrong one leaves behind is unaddressable".
    doc.addEventListener('keydown', (event) => {
      if (matchesShortcut('select.escape', event) && editing.current) {
        finishTextEditing();
        return;
      }
      if (matchesShortcut('edit.redo', event)) {
        event.preventDefault();
        redoFromFrame();
        return;
      }
      if (matchesShortcut('edit.undo', event)) {
        event.preventDefault();
        undoFromFrame();
      }
    });

    editorEvents.emit('stage:ready', { slideId });
    refreshOverlay();
  }, [slideId, commit, select, refreshOverlay, finishTextEditing]);

  useEffect(
    () => () => {
      // The record must not outlive the stage: the next mount would inherit a
      // uid that means nothing, or worse, means a different element. `forget`
      // rather than `drop` for the same reason as the `[slideId]` effect above
      // — by here React has already taken the frame away, so there is no live
      // DOM to revert the insertion through. Taking the box back is the
      // `mode:changed` listener's job, a beat earlier, while the stage is still
      // whole; this is only the backstop for whatever unmounts the stage
      // without going through the mode.
      forgetTextBox();
      setActiveStage(null);
    },
    [],
  );

  /**
   * Ways out of a text session that do not go through the stage document.
   *
   * While editing, the interaction layer steps aside and the stage's own
   * listeners only see what happens inside the frame — so a click on the canvas
   * background, a panel or the toolbar used to leave the session open with no
   * visible way to end it. These listeners close that gap; they run in the
   * capture phase so nothing downstream can swallow the event first.
   */
  useEffect(() => {
    if (!editingUid) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      // The character-formatting controls act on the live session; clicking
      // one must not be the thing that closes it. It may cost the frame its
      // selection though — a native select takes focus — so the range is
      // remembered now, while it still exists.
      if (target?.closest(`[${TEXT_TOOLS_ATTRIBUTE}]`)) {
        snapshotSessionRange();
        return;
      }
      // Overlay chrome (the shields) closes the session itself, and closing it
      // here first would unmount those elements mid-dispatch.
      if (target?.closest('.stage-overlay')) return;
      finishTextEditing();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesShortcut('select.escape', event)) return;
      // Consumed here, otherwise the same key would also walk the selection one
      // level out on its way down: one Escape, one meaning.
      event.stopPropagation();
      finishTextEditing();
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [editingUid, finishTextEditing]);

  useEffect(() => {
    if (!editingUid) return;
    refreshFormatState();
    const timer = window.setInterval(refreshFormatState, FORMAT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [editingUid]);

  // Undo and redo can run with a session open, and both rewrite the element's
  // markup. The session's idea of what the history already holds has to move
  // with them, or closing the session would record the step just taken back.
  //
  // The whole store is watched, so this also fires when `execute` pushes;
  // `resyncTextBaseline` is what tells the two apart, and has to, because a
  // push must leave the baseline where it is (issues #44).
  //
  // It is also where the mutation observer above learns that what is about to
  // land in it is the history's doing and not a paste. `isRestoring()` cannot
  // answer that: it is true only while `revert` runs, and the observer is not
  // notified until the task that ran it has finished. So the window is held
  // open across exactly that gap — raised while the store publishes, which is
  // synchronous inside `undo`, and lowered in a microtask queued *after* the
  // observer's own, which was queued the moment the markup was written. Same
  // shape, and the same measured reason, as `withUndo`'s handling of
  // `isFormatting` (core/editing/richText.ts).
  //
  // `lastAt` is the test for the same reason `resyncTextBaseline` uses it: the
  // stamp is written by `execute` and cleared by `undo` / `redo` / `revoke`, so
  // the store already says which kind of publication this is and there is no
  // second flag to keep in step with it.
  useEffect(() => {
    if (!editingUid) return;
    return useHistory.subscribe(() => {
      if (useHistory.getState().lastAt === 0) {
        restoringMarkup.current = true;
        queueMicrotask(() => {
          restoringMarkup.current = false;
        });
      }
      resyncTextBaseline();
    });
  }, [editingUid]);

  /**
   * Keeps the marks in step with markup the history puts back.
   *
   * A box the user emptied keeps its mark after the session closes (see
   * `finishTextEditing`), which is what leaves it selectable and open for
   * typing again (issues #104). ⌘Z can then put its words back with no session
   * open, and the session's own observer — the only thing that syncs the mark —
   * is long gone: the prompt would be painted over the text that had just come
   * back. So every history step sweeps whatever is marked. Cheap: a slide wears
   * a handful of marks at most, and the query runs once per undo, not per
   * mutation.
   */
  useEffect(() => {
    return useHistory.subscribe(() => {
      const doc = frameRef.current?.contentDocument;
      if (!doc) return;
      for (const marked of Array.from(doc.querySelectorAll(`[${BLANK_ATTRIBUTE}]`))) {
        syncBlankMark(marked);
      }
    });
  }, []);

  /** The context menu asking for a selection; the stage owns selection + breadcrumb. */
  const selectUid = useSelectRequest((s) => s.uid);
  useEffect(() => {
    if (!selectUid) return;
    useSelectRequest.getState().clear();
    const element = bridgeRef.current?.resolve(selectUid);
    if (element) selectElement(element);
  }, [selectUid, selectElement]);

  const textEditUid = useTextEditRequest((s) => s.uid);
  useEffect(() => {
    if (!textEditUid) return;
    useTextEditRequest.getState().clear();
    const element = bridgeRef.current?.resolve(textEditUid);
    // The same pair of tests the menu used to decide whether to offer the item,
    // asked again here because a request is just a uid and the stage owns every
    // rule about entering a session. It used to be `isBlank`, which was looser
    // than the menu's own condition — any empty element that reached this store
    // would have been opened. Nothing did, but the two now say the same thing.
    if (element && (isTextEditable(element) || isUntouchedTextBox(textEditUid, element))) {
      startTextEditing(textEditUid);
    }
  }, [textEditUid, startTextEditing]);

  /* ------------------------------------------------------------- keyboard */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (editing.current) return;
      // Escape means four things here, and the order is what keeps them apart:
      // abandon the drag in progress first, then leave the crop, then step the
      // selection out. Deciding it in one place is what stops two of them from
      // firing on the same key.
      const escape = matchesShortcut('select.escape', event);
      if (escape && (croppingRef.current?.active || gesturesRef.current?.active)) {
        event.stopPropagation();
        if (croppingRef.current?.active) croppingRef.current.cancel();
        else gesturesRef.current?.cancel();
        // The gesture wrote to the stage as it went; put the store back in step
        // with the DOM it just restored.
        commit();
        return;
      }
      // A crop is confirmed as it is dragged, so both keys mean "done" and
      // neither means "revert" — the way out of a crop you regret is Undo,
      // which is where PowerPoint puts it too.
      if (cropTarget && (escape || matchesShortcut('select.editText', event))) {
        event.stopPropagation();
        stopCrop();
        return;
      }
      if (escape) {
        const bridge = bridgeRef.current;
        const uid = useSelectionStore.getState().uid;
        const current = uid ? bridge?.resolve(uid) : null;
        const parent = current ? stepOutward(current) : null;
        if (parent) selectElement(parent);
        else clearSelection();
        return;
      }

      // Tab and Enter only mean this while the stage has the focus. Taking them
      // from the toolbar or the inspector would break tabbing through the app.
      const active = document.activeElement;
      if (active && active !== document.body && !active.classList.contains('stage-interaction')) {
        return;
      }

      const bridge = bridgeRef.current;
      if (!bridge) return;
      const uid = useSelectionStore.getState().uid;
      const current = uid ? (bridge.resolve(uid) as HTMLElement | null) : null;

      const backwards = matchesShortcut('select.prev', event);
      if (backwards || matchesShortcut('select.next', event)) {
        event.preventDefault();
        const next = current ? siblingStep(current, backwards ? -1 : 1) : firstSelectable(bridge);
        if (next) selectElement(next);
        return;
      }

      // The counterpart to Escape: one steps out of the object, the other steps
      // into its text. F2 is the same key PowerPoint uses.
      // The freshly inserted box is let in the same way a double-click lets it
      // in; see `handleLayerDoubleClick` for why the test is bolted on here
      // rather than folded into `isTextEditable`.
      if (
        uid &&
        current &&
        matchesShortcut('select.editText', event) &&
        (isTextEditable(current) || isUntouchedTextBox(uid, current))
      ) {
        event.preventDefault();
        startTextEditing(uid);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clearSelection, selectElement, cropTarget, stopCrop, commit, startTextEditing]);

  if (!slide) return <div className="stage-empty">{t('stage.empty')}</div>;

  return (
    <StageSurface designWidth={designWidth} designHeight={designHeight} scale={scale}>
      <iframe
        key={`${slideId}-${reloadToken}`}
        ref={frameRef}
        className="stage-frame"
        title={t('stage.editTitle')}
        srcDoc={srcDoc}
        sandbox="allow-same-origin"
        onLoad={handleLoad}
        style={{ opacity: 1, zIndex: 1 }}
      />
      <div
        ref={layerRef}
        className="stage-interaction"
        // Focusable so that ending a text session can pull focus out of the
        // frame; -1 keeps it out of the tab order.
        tabIndex={-1}
        style={{ pointerEvents: editingUid ? 'none' : 'auto' }}
        onPointerDown={handleLayerPointerDown}
        onPointerMove={handleLayerPointerMove}
        onPointerUp={handleLayerPointerUp}
        onPointerCancel={handleLayerPointerCancel}
        onDoubleClick={handleLayerDoubleClick}
        onContextMenu={handleContextMenu}
        onPointerLeave={() => setHoverBox(null)}
      />
      {cropBoxes && (
        <CropOverlay
          frame={cropBoxes.frame}
          picture={cropBoxes.picture}
          scale={scale}
          onGripDown={handleCropGripDown}
        />
      )}
      <Overlay
        selection={cropBoxes ? null : selectionBox}
        hover={hoverBox}
        focus={focusBox}
        guides={guides}
        measure={measure}
        scale={scale}
        stageWidth={designWidth}
        stageHeight={designHeight}
        editing={editingUid !== null}
        onHandleDown={handleHandleDown}
        onFrameDown={handleFrameDown}
        onRotateDown={handleRotateDown}
        onShieldDown={handleShieldDown}
        onTextDown={handleTextDown}
        onTextMove={handleTextMove}
        onTextUp={handleTextUp}
        onContextMenu={handleContextMenu}
      />
    </StageSurface>
  );
}

/**
 * Gives an address to anything inside the edited box that has lost one.
 *
 * The insurance half of "⌘Z must not be the browser's" (see `handleLoad`).
 * Where the key handler can be reached — Chromium — nothing here ever fires,
 * because the app's undo puts back markup the editor itself recorded, uids and
 * all. Where it cannot — WebKit runs no listener in a scripting-disabled
 * document, not even one the host attached (ADR-0002) — the engine's own undo
 * runs instead and hands back a run it re-created from its own transaction
 * log: measured, `<u>2026 </u>` where the box had
 * `<u data-hse-uid="e3d">2026 </u>`. An element with no uid is one nothing can
 * address: the click that resolves to it finds nothing and silently does
 * nothing, and every command aimed at it misses (invariant 6).
 *
 * So the box is swept once a batch of mutations has settled and anything
 * nameless is renamed. `reindex` is the bridge's own stamping pass, which is
 * what `commitTextSession` already runs before it reads the markup — this only
 * runs it earlier, so that the element is addressable between commits as well.
 *
 * Cheap in the case that happens constantly: typing into an existing run mints
 * no element, so the `querySelector` finds nothing and the sweep is skipped.
 * It costs a walk only when something actually appeared — Return, a list, an
 * engine undo — and at most once an animation frame.
 *
 * What this deliberately does *not* try to do is put the history back in step.
 * A native undo leaves the app's stack untouched while the DOM moves under it,
 * and the markup the box ends up with is recorded by the next
 * `commitTextSession` as if the user had made that change by hand — which is
 * wrong, but wrong in a way that is still undoable, whereas an unaddressable
 * element is not recoverable at all.
 */
function readdressUnknownElements(element: Element, bridge: StageBridge | null): void {
  if (!bridge) return;
  if (!element.querySelector(`:not([${UID_ATTRIBUTE}])`)) return;
  bridge.reindex();
}

/**
 * ⌘Z / ⌘⇧Z arriving from inside the frame.
 *
 * Anything typed since the last step goes on the stack first, so that ⌘Z takes
 * back the typing rather than reverting an older step and leaving the typing
 * standing on top of it. That is what clicking the toolbar's 元に戻す already
 * does — the press is host chrome, so it ends the session, and ending one
 * commits (`finishTextEditing`) — and the key has to mean the same thing.
 *
 * The flush runs ahead of redo as well, and there it can legitimately make the
 * redo do nothing: `execute` clears the redo stack, so typing after an undo
 * throws the redo away. That is the honest answer and the same one every other
 * edit gives; it is only visible here because the two happen on one keypress.
 */
function undoFromFrame(): void {
  commitTextSession();
  undo();
}

function redoFromFrame(): void {
  commitTextSession();
  redo();
}

/** Where Tab starts from when nothing is selected yet. */
function firstSelectable(bridge: StageBridge): Element | null {
  for (const element of bridge.editableElements()) {
    if (chooseSelectionTarget(element) === element) return element;
  }
  return null;
}

/**
 * Hands focus back to the host after a text session.
 *
 * Dropping `contenteditable` alone leaves the caret in place and the frame
 * holding the window's focus, so the host stops seeing key events entirely:
 * Escape, the arrow keys and Delete all go quiet and the editor feels stuck.
 * Focus therefore moves to the interaction layer, which is where the next
 * gesture would land anyway.
 */
/**
 * The two rectangles the crop chrome draws, in stage coordinates.
 *
 * The picture's own `getBoundingClientRect` cannot be used for this: once the
 * frame is rotated it reports the *axis-aligned* bounds of a tilted rectangle,
 * which is a different shape from the one being cropped. Its placement inside
 * the frame is unrotated by definition, so the box is built from that and given
 * the frame's angle.
 */
function measureCrop(
  bridge: StageBridge,
  target: { frameUid: string; pictureUid: string } | null,
): { frame: OrientedBox; picture: OrientedBox } | null {
  if (!target) return null;
  const frameElement = bridge.resolve(target.frameUid) as HTMLElement | null;
  const pictureElement = bridge.resolve(target.pictureUid) as HTMLElement | null;
  if (!frameElement || !pictureElement) return null;

  const frame = boxOf(frameElement);
  const placement = readPlacement(pictureElement);
  const offset = rotateVector(
    placement.left + placement.width / 2 - frame.width / 2,
    placement.top + placement.height / 2 - frame.height / 2,
    frame.rotation,
  );

  return {
    frame,
    picture: {
      cx: frame.cx + offset.x,
      cy: frame.cy + offset.y,
      width: placement.width,
      height: placement.height,
      rotation: frame.rotation,
    },
  };
}

function releaseTextFocus(element: HTMLElement, layer: HTMLDivElement | null): void {
  element.ownerDocument.defaultView?.getSelection()?.removeAllRanges();
  element.blur();
  layer?.focus({ preventScroll: true });
  // The host document keeps a selection of its own, and leaving a text session
  // leaves it behind: measured after Escape, the host selection was empty but
  // still `isCollapsed: false`. A press that lands inside a live range is what
  // makes the browser drag it rather than start a gesture, so the range has to
  // go too — the frame's selection alone was never the whole of it (#16 (a)).
  layer?.ownerDocument.defaultView?.getSelection()?.removeAllRanges();
}


/** Converts a pointer or mouse event on overlay chrome into stage coordinates. */
function pointInLayer(
  layer: HTMLDivElement,
  event: { clientX: number; clientY: number },
): { x: number; y: number } {
  const rect = layer.getBoundingClientRect();
  const scaleX = layer.offsetWidth / rect.width;
  const scaleY = layer.offsetHeight / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

/** Interface text as a CSS string literal, for a `content` declaration. */
function cssString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\A ')}"`;
}

/**
 * Editor-only styling. It lives in `<head>`, and serialization only ever reads
 * the slide roots, so none of this can reach the saved document.
 */
function injectEditorStyles(doc: Document): void {
  const style = doc.createElement('style');
  style.setAttribute('data-hse-editor-style', '');
  style.textContent = `
    [contenteditable="true"] { cursor: text !important; outline: none !important; }
    ::selection { background: rgba(56, 132, 255, 0.35); }
    /* While a crop is open the frame stops clipping, so the part being cut away
       stays on screen to aim with. A rule rather than an inline style: the
       element's own style attribute is what gets saved, and this must not be. */
    [${CROPPING_ATTRIBUTE}] { overflow: visible !important; }
    /* An inserted text box starts empty, and an empty box is invisible — so the
       prompt is painted for as long as one is open for typing. Drawn by a
       pseudo-element rather than inserted as text: nothing here is in the
       document, so it cannot be saved, copied or exported by accident. The
       rules themselves live with the mark they select on (placeholder.ts),
       where what a selector can and cannot ask is already the subject; only the
       wording is this file's, since interface text comes from the catalogue. */
    ${placeholderRules(cssString(t('stage.textBoxPlaceholder')))}
  `;
  doc.head.appendChild(style);
}
