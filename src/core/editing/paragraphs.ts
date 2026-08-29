/**
 * The `<div>` a browser wraps a line in, and the one shape of it that may be
 * taken back off.
 *
 * `contenteditable` decides for itself what to wrap a new line in, and the
 * editor cannot tell it otherwise: `defaultParagraphSeparator` is set through
 * `document.execCommand` *inside* the edited document, and the edit stage is
 * sandboxed without `allow-scripts` (invariant 3), so nothing runs in there to
 * set it. Taking the key over from the outside is no better — WebKit fires no
 * listener at all in a script-disabled document, listeners the host added from
 * the parent frame included (features/editing-engine/design.md,
 * 「インライン編集の抜け方」), so Enter is not observable from here on the
 * engine the app actually ships on. Whatever the browser leaves behind is what
 * the editor has to live with, and the only place left to act is the commit.
 *
 * Measured on Chromium with the real stage, what a box collects is asymmetric:
 *
 *     typing 「あ」 into an empty box  ->  `あ`  (a bare text node)
 *     Enter in an empty box           ->  `<div><br></div><div><br></div>`
 *     「あ」, Enter, 「い」            ->  `あ<div>い</div>`
 *     one line bulleted               ->  `<ul><li>あいう</li></ul>`
 *
 * The first line stays bare and every line after it is wrapped. Nearly all of
 * that is a line the user asked for and has to stay — collapsing two `<div>`s
 * into one would join two lines the user separated on purpose. The exception is
 * a box left holding **one** `<div>` and nothing else. That one is not a line
 * break, because there is no second line for it to break from; it is a wrapper
 * around the whole content, and it is the extra level the report was about
 * ("a div appears under my text box that I never made").
 *
 * ## Why this unwraps where the paste cleanup refuses to
 *
 * The paste cleanup strips attributes but never unwraps: a `<span>` left with
 * nothing on it stays (decisions #62). That rule is about markup arriving from
 * somewhere else, where the nesting is the author's — dropping a level there
 * moves things on the page, and the cleanup has no way to know what the level
 * was doing. The rule here is not a claim about where the `<div>` came from
 * (see below for why provenance is not usable) but about the strip being
 * invisible: it is the element's only child, so nothing is spliced in beside
 * anything, and it declares nothing of its own, so nothing is lost when it
 * goes. Where that does not hold, this leaves the markup alone, which is the
 * same side of the fence #62 falls on.
 *
 * Provenance would have been the tighter test — "this `<div>` was not here when
 * the session opened" is exactly what we mean — and it was rejected because the
 * baseline it needs belongs to the open session (`richText.ts`). A box saved
 * once and reopened comes back with the doubled `<div>` already in it and no
 * session ever minted it, so keying on the session would leave every deck saved
 * before this fix stuck with the extra level for good.
 *
 * ## What still cannot be promised
 *
 * "Declares nothing of its own" is a statement about the element, not about the
 * page: a deck rule reaching for a bare `.box > div` or a `:nth-child` under
 * the box notices the level going away, which is invariant 2 ③ territory. That
 * is the residual the 裁定 accepts — a text box whose own content is a single
 * unattributed `<div>` is browser output in every deck seen so far, and the
 * alternative is leaving the level in every box anyone types a second line
 * into. Anything with a class, a style, an id or any other attribute is treated
 * as the deck's and is never touched, which is where that risk is bounded.
 */

import { UID_ATTRIBUTE } from '../../shared/ids';

/**
 * The `<div>` wrapping the whole of this element's content, or null when there
 * is nothing to take off.
 *
 * Split from the unwrapping so the decision can be asked about in a test:
 * everything that makes it safe is here, and everything below is moving nodes.
 *
 * The three conditions, and what each is keeping out:
 *
 * - **exactly one child node.** `childNodes`, not `children`: `あ<div>い</div>`
 *   has one child *element* while plainly holding two lines, and unwrapping
 *   there would run the second line into the first. Counting nodes catches
 *   that, and it also declines a `<div>` with whitespace around it — a
 *   whitespace-only text node is still a node, and under the `white-space:
 *   pre-wrap` decks do set it is a visible one, so "exactly one" is taken at
 *   face value rather than after a trim.
 * - **it is a `<div>`.** The separator the engines mint is a `<div>`; a `<ul>`
 *   or a `<p>` sitting alone in a box is content, and this says nothing about
 *   it. `<li>` in particular must survive — `listOverrides.ts` writes overrides
 *   onto list nodes by uid, and a list flattened here would take them with it.
 * - **no attribute but the uid.** A `<div style="text-align:center">` is what
 *   `execCommand('justifyCenter')` leaves on a single-line box, and stripping
 *   it would silently undo the alignment; a class or an id may be the deck's
 *   own hook. The uid is the one exception because `reindex()` stamps it onto
 *   every element in the slide unconditionally, so its presence distinguishes
 *   nothing from nothing — and serialization takes it off again anyway
 *   (`cleanElement` in stage/bridge.ts), so a `<div>` carrying only a uid is
 *   already an attribute-less `<div>` in the saved file.
 *
 * Takes an `Element` and reads only DOM interface members, never `instanceof`:
 * the elements handed here live in the stage iframe, and this window's
 * constructors do not match those (the cross-realm trap `listOverrides.ts`
 * works around by asking `defaultView`).
 */
export function soleParagraphWrapper(element: Element): Element | null {
  if (element.childNodes.length !== 1) return null;

  // Non-null only when that single node is itself the element, so no cast and
  // no node-type check is needed to know they are the same node.
  const wrapper = element.firstElementChild;
  if (!wrapper || wrapper.tagName !== 'DIV') return null;

  const declares = Array.from(wrapper.attributes).some((attr) => attr.name !== UID_ATTRIBUTE);
  return declares ? null : wrapper;
}

/**
 * Takes off every wrapper the rule above allows, leaving the content where the
 * wrappers were.
 *
 * Loops rather than peeling one level, because one level is not a fixed point:
 * `<div uid><div><div>あ</div></div></div>` would come out a level shallower
 * on every open-and-commit, so the same file would keep changing every time it
 * was touched. Invariant 2 ② asks the round trip to settle, and it settles here
 * — the loop stops only when the answer is "nothing to take off", which is
 * exactly the answer the next pass would get. It terminates for the same
 * reason: each turn removes a node.
 *
 * The children are **moved**, not rebuilt, so a range anchored to a text node
 * inside survives and the caret rides along (the same reason
 * `dropPreservationSpans` moves rather than rebuilds). A caret whose container
 * is the wrapper itself — the empty box, `<div><br></div>` with the caret at
 * offset 0 — has nowhere to ride to, so the natural place to call this is where
 * the caret no longer has to survive: as the session commits.
 */
export function unwrapSoleParagraphs(element: Element): void {
  for (
    let wrapper = soleParagraphWrapper(element);
    wrapper !== null;
    wrapper = soleParagraphWrapper(element)
  ) {
    wrapper.replaceWith(...Array.from(wrapper.childNodes));
  }
}

/** Blocks a Return can mint. The engines differ, so both spellings are named. */
const PARAGRAPH_TAGS = new Set(['DIV', 'P']);

/**
 * The empty paragraph at the end, or null when the last line has something in
 * it.
 *
 * Return is not a way to finish editing, but it is what people press when they
 * mean "done" — and in a `contenteditable` it runs `insertParagraph`, which
 * mints a block: measured on the user's own deck, `aaa` followed by Return left
 * `aaa<div><br></div>` behind. Two children, so {@link soleParagraphWrapper}
 * refuses it, and the block survives the session — with a uid of its own, since
 * `reindex()` stamps every element, which makes the stray line separately
 * selectable and draws it a selection frame of its own.
 *
 * There is no way to catch the key instead. The stage frame runs no scripts, so
 * WebKit fires no listener the host attached (ADR-0002), and
 * `defaultParagraphSeparator` only chooses which tag is minted, never whether.
 * So it is undone afterwards, here.
 *
 * **Only at the end, and only where nothing would be read.** A blank line
 * *between* two paragraphs is spacing the user asked for and is left alone; a
 * blank one at the end is only ever the Return that ended the sentence. The
 * same attribute test as the unwrap rule applies — anything the deck or a
 * formatting command declared on the block stays, because taking it off would
 * change what the remaining text looks like.
 */
export function trailingEmptyParagraph(element: Element): Element | null {
  const last = element.lastElementChild;
  if (!last || last !== element.lastChild) return null;
  if (!PARAGRAPH_TAGS.has(last.tagName)) return null;
  // What `isBlank` asks of a box, asked of one line: a `<br>` is how an empty
  // line is spelled, and it is still an empty line.
  if ((last.textContent ?? '') !== '' || last.querySelector(':not(br)') !== null) return null;

  const declares = Array.from(last.attributes).some((attr) => attr.name !== UID_ATTRIBUTE);
  return declares ? null : last;
}

/**
 * Drops the empty paragraphs Return left at the end.
 *
 * Loops for the same reason {@link unwrapSoleParagraphs} does: two presses
 * leave two blocks, and a pass that took one would leave the file changing
 * every time it was opened. Run this **before** the unwrap — clearing the
 * trailing block is what can leave a single wrapper behind for it to take off
 * (`<div>aaa</div><div><br></div>` → `<div>aaa</div>` → `aaa`).
 */
export function dropTrailingEmptyParagraphs(element: Element): void {
  for (
    let last = trailingEmptyParagraph(element);
    last !== null;
    last = trailingEmptyParagraph(element)
  ) {
    last.remove();
  }
}
